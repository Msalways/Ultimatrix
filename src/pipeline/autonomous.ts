import { type BaseChatModel } from '@langchain/core/language_models/chat_models';
import { type BaseMessage, HumanMessage, AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import { Logger, colors } from '../cli/logger';
import { toolRegistry } from '../tools/tool-registry';
import { createAskUserTool } from '../tools/ask-user-tool';
import { readAppModel, compileReport, calculateOverallRisk, updateAppModelSection, type AppModel } from '../core/app-model';
import type { Finding, ScanTarget, ScanEventEmitter } from '../core/types';
import { getSharedBrowserManager } from '../tools/browser-tools';
import type { DashboardServer } from '../dashboard/server';
import type { DashboardEvent } from '../dashboard/server';
import { ensureOastRunning, stopOast } from '../oast';
import { setAppModelPath } from '../core/app-model-path';
import { STRATEGIST_PROMPT } from '../prompts/threat-model';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

const log = new Logger();
const MAX_TURNS = 10;
const SAVE_INTERVAL = 3;

export class AutonomousOrchestrator {
  private model: BaseChatModel;
  private target: ScanTarget;
  private events?: ScanEventEmitter;
  private outputDir: string;
  private format: string;
  private appModelPath: string;
  private dashboard?: DashboardServer;
  private maxToolCalls: number;
  private keepBrowser: boolean;
  private abortSignal?: AbortSignal;

  private waitingForInputResolver: ((text: string) => void) | null = null;
  private inputChannel: string[] = [];
  private autoContinue: boolean;

  constructor(config: {
    model: BaseChatModel;
    target: ScanTarget;
    events?: ScanEventEmitter;
    outputDir: string;
    format?: string;
    appModelPath: string;
    dashboard?: DashboardServer;
    maxToolCalls?: number;
    keepBrowser?: boolean;
    abortSignal?: AbortSignal;
    autoContinue?: boolean;
  }) {
    this.model = config.model;
    this.target = config.target;
    this.events = config.events;
    this.outputDir = config.outputDir;
    this.format = config.format || 'markdown';
    this.appModelPath = config.appModelPath;
    setAppModelPath(this.appModelPath);
    this.dashboard = config.dashboard;
    this.maxToolCalls = config.maxToolCalls || 50;
    this.keepBrowser = config.keepBrowser || false;
    this.abortSignal = config.abortSignal;
    this.autoContinue = config.autoContinue ?? true;
  }

  private emitDashboardEvent(type: DashboardEvent['type'], data: Record<string, unknown>): void {
    if (!this.dashboard) return;
    try {
      this.dashboard.emit({ type, data, timestamp: new Date().toISOString() });
    } catch { /* best effort */ }
  }

  sendUserMessage(text: string): void {
    if (this.waitingForInputResolver) {
      const r = this.waitingForInputResolver;
      this.waitingForInputResolver = null;
      r(text);
    } else {
      this.inputChannel.push(text);
    }
  }

  private async savePartialReport(turn: number, finalModel?: AppModel): Promise<void> {
    const model = finalModel || readAppModel(this.appModelPath);
    const pwDir = path.join(this.outputDir, 'playwright');
    try {
      const mgr = getSharedBrowserManager();
      const strategistSteps = mgr.stopRecording('default') || [];
      const spiderSteps = model.recordedSessions?.['spider-auto'] || [];
      const workerActions = model.workerActions || [];
      const allSteps = [...spiderSteps, ...strategistSteps];
      if (allSteps.length > 0 || workerActions.length > 0) {
        const { generateSecurityPlaywrightTest } = await import('../core/trace-utils');
        const docData = (model.workflow.nodes.length > 0 || model.forms.length > 0) ? {
          routes: model.workflow.nodes.map((n) => ({
            url: n.url,
            title: n.title,
            forms: model.forms.filter((f) => f.pageUrl === n.url).length,
            links: 0,
          })),
          forms: model.forms.map((f) => ({
            pageUrl: f.pageUrl,
            action: f.action,
            fields: f.fields.map((fd) => ({ name: fd.name, type: fd.type })),
          })),
          totalRoutes: model.workflow.nodes.length,
          auth: { type: model.auth.type, loginEndpoint: model.auth.loginEndpoint },
          techStack: model.techStack || [],
        } : undefined;
        const files = generateSecurityPlaywrightTest({
          browserSteps: allSteps,
          workerActions,
          target: typeof this.target === 'string' ? this.target : '',
          outputDir: pwDir,
          docData,
        });
        log.success(`Playwright test generated (turn ${turn}): ${files.join(', ')}`);
      }
    } catch (e) {
      log.warn(`Playwright test generation (turn ${turn}) failed: ${e}`);
    }
    // Re-start recording for the next batch of turns
    try {
      const mgr2 = getSharedBrowserManager();
      mgr2.startRecording('default');
    } catch { /* best effort */ }
  }

  private async waitForUserInput(autoContinueMessage = 'Continue the assessment. Read the attack plan, check for remaining hypotheses, and spawn workers.'): Promise<string> {
    if (this.inputChannel.length > 0) return this.inputChannel.shift()!;
    if (this.abortSignal?.aborted) return '/close';
    if (this.autoContinue) return autoContinueMessage;
    return new Promise(resolve => {
      this.waitingForInputResolver = resolve;
      if (this.abortSignal) {
        this.abortSignal.addEventListener('abort', () => {
          resolve('/close');
        }, { once: true });
      }
    });
  }

  private async streamModel(
    model: any,
    messages: BaseMessage[],
  ): Promise<AIMessage> {
    const stream = await model.stream(messages);
    let accumulated: AIMessageChunk | null = null;
    const announcedTools = new Set<string>();

    for await (const chunk of stream) {
      if (this.abortSignal?.aborted) break;
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;

      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (text && !chunk.tool_call_chunks?.length) {
        process.stdout.write(text);
      }

      if (chunk.tool_call_chunks?.length) {
        for (const tc of chunk.tool_call_chunks) {
          if (tc.name && !announcedTools.has(tc.id ?? '')) {
            announcedTools.add(tc.id ?? '');
            process.stdout.write(`\n  ${chalk.cyan('\u2699')} ${chalk.bold(tc.name)}...`);
          }
        }
      }
    }

    return accumulated as AIMessage;
  }

  async run(): Promise<{ findings: Finding[]; reportPath: string }> {
    const fsp = fs.promises;

    fs.mkdirSync(this.outputDir, { recursive: true });

    const targetUrl = typeof this.target === 'string' ? this.target : (this.target as any).url || String(this.target);
    const fmt = this.format === 'html' ? 'html' : this.format === 'json' ? 'json' : 'md';
    const reportPath = path.join(this.outputDir, `final-security-report.${fmt}`);

    let oastPort: number | null = null;
    try {
      oastPort = await ensureOastRunning(path.join(this.outputDir, 'oast-callbacks.json'));
      log.info(`OAST server running on port ${oastPort}`);
      this.emitDashboardEvent('status', { message: `OAST server on port ${oastPort}` });
    } catch (e) {
      log.warn(`OAST server failed to start: ${e}`);
    }

    // ── Spider crawl → builds app model ──
    let spiderRoutes = 0;
    const modelExists = fs.existsSync(this.appModelPath);
    if (!modelExists) {
      log.info('No app model found — running spider crawl...');
      this.emitDashboardEvent('status', { message: 'Spider crawling target' });
      try {
        const { SpiderCrawler } = await import('../explorer/spider');
        const mgr = getSharedBrowserManager();
        const spider = new SpiderCrawler(mgr);
        const crawlResult = await spider.crawl(targetUrl, 2, undefined, this.outputDir);
        spiderRoutes = crawlResult.totalRoutes;
        const { spiderResultToAppModel } = await import('../explorer/spider-bridge');
        const bridgeResult = spiderResultToAppModel(crawlResult, targetUrl);
        const { DEFAULT_MODEL } = await import('../core/app-model');
        const merged: AppModel = {
          ...DEFAULT_MODEL,
          ...bridgeResult.model,
          target: targetUrl,
        };
        fs.writeFileSync(this.appModelPath, JSON.stringify(merged, null, 2));
        log.success(`App model built: ${crawlResult.totalRoutes} routes, ${merged.endpoints.length} API endpoints`);
        if (spiderRoutes === 0) {
          const mgr2 = getSharedBrowserManager();
          await mgr2.close('default');
        }
      } catch (e) {
        log.warn(`Spider crawl failed: ${e} — running without pre-built model`);
        const mgr2 = getSharedBrowserManager();
        await mgr2.close('default');
      }
    } else {
      log.dim(`Reusing existing app model at ${this.appModelPath}`);
    }

    // ── Start strategist-phase recording ──
    try {
      const mgr = getSharedBrowserManager();
      mgr.startRecording('default');
    } catch { /* best effort */ }

    // ── Derive attack plan from app model ──
    const { createAttackPlan, deriveHypotheses, prioritize } = await import('../core/attack-plan');
    const appModel = readAppModel(this.appModelPath);
    const plan = createAttackPlan({ maxConcurrency: 4 });
    const newH = deriveHypotheses(appModel, plan, 'spider');

    // Filter: skip hypotheses for thin routes (low content score pages)
    const thinUrls = new Set((appModel as any).thinRoutes || []);
    const filteredH = newH.filter(h => {
      if (h.type === 'param' && thinUrls.has(h.endpoint)) return false;
      if (h.type === 'form' && thinUrls.has(h.action)) return false;
      return true;
    });
    if (filteredH.length < newH.length) {
      log.dim(`Filtered out ${newH.length - filteredH.length} hypotheses for thin routes`);
    }
    plan.hypotheses = plan.hypotheses.concat(filteredH);

    const prioritized = prioritize(plan, appModel.findings);
    updateAppModelSection(this.appModelPath, 'hypotheses', prioritized, true);

    // ── Build system prompt ──
    let systemPrompt = STRATEGIST_PROMPT;
    systemPrompt += `\n\nTarget URL: ${targetUrl}`;
    systemPrompt += `\nOutput directory: ${this.outputDir}`;
    systemPrompt += `\nApp model path: ${this.appModelPath}`;
    if (oastPort) {
      systemPrompt += `\n\nOAST callback server running on port ${oastPort}. Use oast_create_url for blind payloads.`;
    }
    systemPrompt += `\n\nAttack plan has ${prioritized.length} hypotheses. Read them with read_attack_plan, then spawn workers.`;

    const allTools = toolRegistry.getAll();
    const askUserTool = createAskUserTool();
    const allToolsWithAskUser = [...allTools, askUserTool];
    const boundModel = (this.model as any).bindTools(allToolsWithAskUser);

    log.info('Strategist starting...');
    this.emitDashboardEvent('status', { message: 'Strategist launched' });

    const messages: BaseMessage[] = [
      new HumanMessage(`Begin assessment of ${targetUrl}. 

The spider has already mapped all pages. DO NOT use browser navigation tools.

=== Action Plan ===
1. Read the "forms" section from the app model to see which endpoints have parameters
2. Read the "endpoints" section to see API endpoints
3. For each endpoint with a parameter, start a worker to test it (sqli, xss, ssrf)
4. Read results and start more workers as needed

Start by reading the forms section.`),
    ];

    let turnCount = 0;

    while (turnCount < MAX_TURNS) {
      if (this.abortSignal?.aborted) {
        process.stdout.write(colors.warn(`\nReceived abort signal. Stopping.\n`));
        break;
      }

      // ── Inner loop: LLM → tools → LLM → tools → ... → text ──
      let toolCallCount = 0;
      let response: AIMessage;

      process.stdout.write(chalk.dim('\n  LLM: '));
      response = await this.streamModel(boundModel, messages);
      process.stdout.write('\n');
      messages.push(response);

      while (response.tool_calls?.length && toolCallCount < this.maxToolCalls) {
        if (this.abortSignal?.aborted) {
          process.stdout.write(colors.warn(`\nAborted during tool execution.\n`));
          break;
        }
        toolCallCount++;

        const toolResults: ToolMessage[] = [];

        // Dispatch all tool calls in parallel
        const toolPromises = response.tool_calls
          .filter(() => !this.abortSignal?.aborted)
          .map(async (tc) => {
            const parsed = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args;
            const argsStr = Object.entries(parsed as Record<string, unknown>)
              .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)}`)
              .join(', ');
            process.stdout.write(`  ${chalk.cyan('\u2192')} ${chalk.bold(tc.name)}(${chalk.dim(argsStr)})\n`);

            const tool = allToolsWithAskUser.find(t => t.name === tc.name);
            if (!tool) {
              return { id: tc.id, content: `Error: unknown tool "${tc.name}"` };
            }
            try {
              const start = Date.now();
              const result = await (tool as any).invoke(tc.args);
              const elapsed = Date.now() - start;
              const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
              const truncated = resultStr.slice(0, 2000);
              process.stdout.write(`  \u2514 ${chalk.dim('Result')}: ${chalk.dim(truncated.slice(0, 200))}${resultStr.length > 200 ? chalk.dim('...') : ''} ${chalk.dim(`(${elapsed}ms)`)}\n`);
              return { id: tc.id, content: truncated };
            } catch (e) {
              const errMsg = `Error: ${e instanceof Error ? e.message : String(e)}`;
              process.stdout.write(`  \u2514 ${chalk.red(errMsg)}\n`);
              return { id: tc.id, content: errMsg };
            }
          });

        const settled = await Promise.all(toolPromises);
        for (const r of settled) {
          if (r) toolResults.push(new ToolMessage({ content: r.content, tool_call_id: r.id ?? '' }));
        }
        messages.push(...toolResults);

        process.stdout.write(chalk.dim('\n  LLM: '));
        response = await this.streamModel(boundModel, messages);
        process.stdout.write('\n');
        messages.push(response);
      }

      if (toolCallCount >= this.maxToolCalls) {
        process.stdout.write(colors.warn(`\nReached ${this.maxToolCalls} tool calls in one turn. Stopping.\n`));
        break;
      }

      const responseText = typeof response.content === 'string' ? response.content : '';
      if (responseText.trim()) {
        process.stdout.write(colors.info(`\n${responseText.trim()}\n`));
      }

      turnCount++;

      if (turnCount % SAVE_INTERVAL === 0) {
        this.savePartialReport(turnCount);
      }

      if (turnCount >= MAX_TURNS) {
        process.stdout.write(colors.warn(`\nReached ${MAX_TURNS} turn limit. Stopping.\n`));
        this.emitDashboardEvent('status', { message: `Reached ${MAX_TURNS} turn limit` });
        break;
      }

      if (!this.autoContinue) {
        process.stdout.write(colors.dim(`\n[Awaiting your input]\n`));
      }
      const userInput = await this.waitForUserInput();

      if (!userInput || userInput.startsWith('/close') || userInput.startsWith('/exit')) {
        if (userInput?.startsWith('/close') || userInput?.startsWith('/exit')) {
          log.warn('User requested early stop...');
        }
        break;
      }

      messages.push(new HumanMessage(userInput));
    }

    // ── Re-discovery of thin routes (if new findings exist) ──
    const finalAppModel = readAppModel(this.appModelPath);
    const thinUrlsForRediscovery = (finalAppModel as any).thinRoutes as string[] | undefined;
    if (thinUrlsForRediscovery && thinUrlsForRediscovery.length > 0 && finalAppModel.findings.length > 0) {
      log.info(`Re-crawling ${thinUrlsForRediscovery.length} thin routes (${finalAppModel.findings.length} findings exist)...`);
      try {
        const { SpiderCrawler } = await import('../explorer/spider');
        const mgr3 = getSharedBrowserManager();
        const rediscThinSet = new Set(thinUrlsForRediscovery);
        for (const thinUrl of thinUrlsForRediscovery) {
          log.dim(`  Re-visiting thin route: ${thinUrl}`);
          const thinSpider = new SpiderCrawler(mgr3);
          const thinResult = await thinSpider.crawl(thinUrl, 1, undefined, this.outputDir);
          if (thinResult.totalRoutes > 0) {
            const { spiderResultToAppModel } = await import('../explorer/spider-bridge');
            const thinBridge = spiderResultToAppModel(thinResult, thinUrl);
            updateAppModelSection(this.appModelPath, 'forms', thinBridge.model.forms, true);
            updateAppModelSection(this.appModelPath, 'endpoints', thinBridge.model.endpoints, true);
            log.success(`  Re-discovered ${thinResult.totalRoutes} route(s) from ${thinUrl}`);
          }
        }
        // Generate new hypotheses from re-discovered content
        const refreshedModel = readAppModel(this.appModelPath);
        const { deriveHypotheses, prioritize: prioritize2 } = await import('../core/attack-plan');
        const newFromRedisc = deriveHypotheses(refreshedModel, plan, 'spider');
        const filteredRedisc = newFromRedisc.filter(h => {
          if (h.type === 'param' && rediscThinSet.has(h.endpoint)) return false;
          if (h.type === 'form' && rediscThinSet.has(h.action)) return false;
          return true;
        });
        if (filteredRedisc.length > 0) {
          plan.hypotheses = plan.hypotheses.concat(filteredRedisc);
          const rePrioritized = prioritize2(plan, refreshedModel.findings);
          updateAppModelSection(this.appModelPath, 'hypotheses', rePrioritized, true);
          log.success(`Added ${filteredRedisc.length} new hypotheses from re-discovery`);
        }
      } catch (e) {
        log.warn(`Re-discovery failed: ${e}`);
      }
    }

    // ── Compile report ──
    process.stdout.write('\n');
    log.info('Compiling report from app model...');
    this.emitDashboardEvent('status', { message: 'Compiling report' });

    const finalModel = readAppModel(this.appModelPath);

    if (finalModel.findings.length > 0) {
      log.info(`Running triage on ${finalModel.findings.length} findings...`);
      this.emitDashboardEvent('status', { message: 'Running finding triage' });
      const { triageFinding, applyTriageToFindings } = await import('../triage');
      const decisions = finalModel.findings.map(f => triageFinding(f, finalModel.findings));
      const triaged = applyTriageToFindings(finalModel.findings, decisions);
      const removed = finalModel.findings.length - triaged.length;
      if (removed > 0) {
        log.info(`Triage: ${removed} finding(s) removed/rejected, ${triaged.length} accepted`);
        finalModel.findings = triaged;
        fs.writeFileSync(this.appModelPath, JSON.stringify(finalModel, null, 2));
      }
      const rejected = decisions.filter(d => d.status === 'rejected').map(d => `  - ${d.candidateId}: ${d.reason}`).join('\n');
      if (rejected) log.dim(`Rejected:\n${rejected}`);
    }

    const risk = calculateOverallRisk(finalModel);
    this.emitDashboardEvent('risk_change', { score: risk.score, level: risk.level, breakdown: risk.breakdown });

    let oastSummary = '';
    try {
      const { getOastServer } = await import('../oast');
      const server = getOastServer();
      if (server) {
        const stats = server.getStats();
        if (stats.totalCallbacks > 0) {
          oastSummary = `\n\n**OAST Callbacks**: ${stats.totalCallbacks} callbacks across ${stats.uniqueUuids} unique URLs`;
        }
      }
    } catch { /* best effort */ }

    try {
      const mgr = getSharedBrowserManager();
      const trace = mgr.stopTrace('default');
      if (trace.length > 0) {
        const { traceToHar } = await import('../core/trace-utils');
        fs.writeFileSync(path.join(this.outputDir, 'session-trace.har'), traceToHar(trace), 'utf-8');
      }
    } catch { /* best effort */ }

    // ── Generate Playwright test from all recordings ──
    try {
      const mgr = getSharedBrowserManager();
      const strategistSteps = mgr.stopRecording('default') || [];
      const spiderSteps = finalModel.recordedSessions?.['spider-auto'] || [];
      const workerActions = finalModel.workerActions || [];
      const allSteps = [...spiderSteps, ...strategistSteps];
      if (allSteps.length > 0 || workerActions.length > 0) {
        const { generateSecurityPlaywrightTest } = await import('../core/trace-utils');
        const pwDir = path.join(this.outputDir, 'playwright');

        // Build doc data from the app model
        const docData = (finalModel.workflow.nodes.length > 0 || finalModel.forms.length > 0) ? {
          routes: finalModel.workflow.nodes.map((n) => ({
            url: n.url,
            title: n.title,
            forms: finalModel.forms.filter((f) => f.pageUrl === n.url).length,
            links: 0,
          })),
          forms: finalModel.forms.map((f) => ({
            pageUrl: f.pageUrl,
            action: f.action,
            fields: f.fields.map((fd) => ({ name: fd.name, type: fd.type })),
          })),
          totalRoutes: finalModel.workflow.nodes.length,
          auth: { type: finalModel.auth.type, loginEndpoint: finalModel.auth.loginEndpoint },
          techStack: finalModel.techStack || [],
        } : undefined;

        const files = generateSecurityPlaywrightTest({
          browserSteps: allSteps,
          workerActions,
          target: targetUrl,
          outputDir: pwDir,
          docData,
        });
        if (files.length > 0) {
          log.success(`Playwright test generated: ${files.join(', ')}`);
        }
      }
    } catch (e) {
      log.warn(`Playwright test generation failed: ${e}`);
    }

    const report = compileReport(finalModel, this.format as any);
    fs.writeFileSync(reportPath, report + oastSummary);
    log.success(`Report written: ${reportPath}`);

    const findings: Finding[] = finalModel.findings.map((f, i) => ({
      id: `finding-${i}`,
      title: f.type,
      description: `Parameter: ${f.param || '-'}, Evidence: ${f.evidence.map(e => e.label).join('; ')}`,
      severity: f.severity as any,
      category: f.type,
      confidence: f.confidence === 'high' ? 0.9 : f.confidence === 'medium' ? 0.6 : 0.3,
      location: f.endpoint || finalModel.target,
      evidence: f.evidence.map(e => `[${e.label}] ${e.data.slice(0, 200)}`).join('\n'),
      remediation: '',
      agent: 'autonomous' as any,
      timestamp: new Date().toISOString(),
    }));

    return { findings, reportPath };
  }

}
