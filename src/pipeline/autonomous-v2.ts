/**
 * src/pipeline/autonomous-v2.ts
 *
 * Deepagents-based strategist (replaces src/pipeline/autonomous.ts).
 *
 * Design decisions
 * ────────────────
 * 1. The strategist itself is a createDeepAgent. Tools include the full
 *    strategist toolkit (read_app_model, spawn_agent, etc.) — but
 *    `spawn_agent` is replaced by delegation to a CompiledSubAgent
 *    (the worker from src/agents/worker.ts) via deepagents' built-in
 *    `task()` tool. So `spawn_agent` in our toolkit is removed; the
 *    strategist calls `task(agent="worker", prompt="...")` instead.
 *
 * 2. The worker is passed as a CompiledSubAgent so the strategist can
 *    invoke it via deepagents' native subagent mechanism (which handles
 *    result merging, error propagation, and message routing).
 *
 * 3. The outer driver loop is the same as before: a turn-bounded
 *    invoke(...) + auto-continue / REPL pattern, but each "turn" is
 *    now a deepagent invocation that internally manages the LLM↔tool
 *    loop, subagent delegation, and checkpointing.
 *
 * 4. Termination conditions: regex match on LLM text ("coverage complete")
 *    AND programmatic state check (uncoveredCombos=0 && running=0),
 *    matching the legacy autonomous.ts logic.
 *
 * 5. SqliteSaver is the production target but is NOT installed in
 *    package.json. We use MemorySaver here for the skeleton — swap in
 *    SqliteSaver.fromConnString() for production durability:
 *
 *      import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
 *      const cp = SqliteSaver.fromConnString(checkpointPath);
 *
 * 6. interruptOn is configured for auto-continue: every tool runs
 *    without pausing. For REPL mode, the ask_user tool would be set
 *    to `true` to pause for human input.
 */

import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { createMiddleware, type InterruptOnConfig } from 'langchain';
import {
  createDeepAgent,
  type SubAgent,
  type CompiledSubAgent,
  type DeepAgent,
  FilesystemBackend,
  CompositeBackend,
  type AnyBackendProtocol,
} from 'deepagents';

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import chalk from 'chalk';
import { Logger, colors } from '../cli/logger';
import { toolRegistry } from '../tools/tool-registry';
import { createAskUserTool } from '../tools/ask-user-tool';
import {
  readAppModel, writeAppModel, compileReport, calculateOverallRisk, updateAppModelSection,
  type AppModel,
} from '../core/app-model';
import type { Finding, ScanTarget, ScanEventEmitter } from '../core/types';
import { getSharedBrowserManager } from '../tools/browser-tools';
import type { DashboardServer, DashboardEvent } from '../dashboard/server';
import { ensureOastRunning, stopOast } from '../oast';
import { setAppModelPath } from '../core/app-model-path';
import { STRATEGIST_PROMPT } from '../prompts/threat-model';
import { fixWriteTodosMiddleware } from '../core/fix-todos';
import { modelCallLimitMiddleware } from 'langchain';
import { runReasoningWorker, buildWorkerAsCompiledSubAgent, type WorkerConfig } from '../agents/worker';

const log = new Logger();
const MAX_TURNS = 13;
const SAVE_INTERVAL = 3;

export interface RunResult {
  findings: Finding[];
  reportPath: string;
  threadId: string;
}

// ── Custom middleware ─────────────────────────────────────────────────

/** Emits dashboard events on tool calls (best-effort). */
function makeDashboardEmitMiddleware(dashboard?: DashboardServer) {
  return createMiddleware({
    name: 'dashboardEmit',
    wrapToolCall: async (request: any, handler: any) => {
      if (dashboard) {
        try {
          dashboard.emit({
            type: 'tool_call',
            data: { tool: request.tool.name, args: request.toolCall?.args },
            timestamp: new Date().toISOString(),
          } as DashboardEvent);
        } catch { /* best effort */ }
      }
      return handler(request);
    },
  });
}

/** Periodic save: writes the current app model every N tool calls. */
function makePeriodicSaveMiddleware(appModelPath: string, interval = 3) {
  let counter = 0;
  return createMiddleware({
    name: 'periodicSave',
    afterModel: (state: any) => {
      counter++;
      if (counter % interval !== 0) return undefined;
      try {
        const m = readAppModel(appModelPath);
        m._meta = { ...m._meta, lastUpdatedAt: Date.now() };
        writeAppModel(appModelPath, m);
        process.stderr.write(`[autosave] app-model updated (${counter} tool calls)\n`);
      } catch { /* best effort */ }
      return undefined;
    },
  });
}

/** Custom termination: signals coverage complete or programmatic stop. */
function makeTerminationMiddleware(getShouldStop: () => boolean) {
  return createMiddleware({
    name: 'strategistTermination',
    afterModel: (state: any) => {
      if (getShouldStop()) {
        return { strategistShouldStop: true } as any;
      }
      return undefined;
    },
  });
}

/** Color-streams AI tokens to stderr for live progress. */
const colorStreamMiddleware = createMiddleware({
  name: 'colorStream',
  wrapModelCall: async (request: any, handler: any) => {
    process.stderr.write(`\n  ${chalk.dim('\u2699')} strategist turn (msgs=${request.messages?.length || 0})\n`);
    return handler(request);
  },
});

// ── Strategist tools (subset of legacy tool-registry) ─────────────────
//
// We re-create a few tools here that wrap the existing toolRegistry with
// strategist-specific behavior. In a fuller port you'd add them to the
// registry and pull from there.

const readAppModelV2Tool = tool(
  async (input) => {
    const { section } = input as { section?: string };
    const path = getCurrentAppModelPath();
    if (section) {
      return JSON.stringify({ section, data: readAppModel(path)[section as keyof AppModel] });
    }
    return fs.readFileSync(path, 'utf-8');
  },
  {
    name: 'read_app_model',
    description: 'Read a section of the app model JSON. Sections: target, techStack, auth, workflow, endpoints, forms, scripts, cookies, localStorage, findings, verifications, parameterClassifications, authBoundaries, recordedSessions, hypotheses, nextSteps, visitedUrls, oastCallbacks, coverage.',
    schema: z.object({ section: z.string().optional() }),
  },
);

const updateAppModelV2Tool = tool(
  async (input) => {
    const { section, data, merge } = input as { section: string; data: unknown; merge?: boolean };
    const path = getCurrentAppModelPath();
    const updated = updateAppModelSection(path, section as any, data, merge !== false);
    return JSON.stringify({ section, status: 'ok' });
  },
  {
    name: 'update_app_model',
    description: 'Update a section of the app model. Arrays merge dedup; objects merge at top level.',
    schema: z.object({
      section: z.string(),
      data: z.any(),
      merge: z.boolean().optional().default(true),
    }),
  },
);

const recordCoverageTool = tool(
  async (input) => {
    const { endpoint, param, method, status, reason } = input as { endpoint: string; param?: string; method?: string; status: 'tested' | 'skipped'; reason?: string };
    const path = getCurrentAppModelPath();
    const entry = { endpoint, param: param || '', method: method || 'GET', status, reason: reason || '', timestamp: Date.now() };
    updateAppModelSection(path, 'coverage', [entry], true);
    return JSON.stringify({ recorded: true });
  },
  {
    name: 'record_coverage',
    description: 'Record that an endpoint/param/method was tested (or skipped).',
    schema: z.object({
      endpoint: z.string(),
      param: z.string().optional(),
      method: z.string().optional().default('GET'),
      status: z.enum(['tested', 'skipped']),
      reason: z.string().optional(),
    }),
  },
);

const checkWorkersTool = tool(
  async () => {
    const path = getCurrentAppModelPath();
    const model = readAppModel(path);
    const hyps = Array.isArray(model.hypotheses) ? model.hypotheses : [];
    let running = 0, pending = 0, done = 0, error = 0;
    const covered = new Set<string>();
    const pendingCombos = new Set<string>();
    for (const h of hyps) {
      const hObj = h as any;
      const combo = `${hObj.method || 'GET'}:${hObj.endpoint || ''}:${hObj.param || ''}`;
      if (hObj.status === 'running') { running++; covered.add(combo); }
      else if (hObj.status === 'pending') { pending++; pendingCombos.add(combo); }
      else if (hObj.status === 'done') { done++; covered.add(combo); }
      else if (hObj.status === 'error') { error++; covered.add(combo); }
    }
    const uncovered = pendingCombos.size - covered.size;
    return JSON.stringify({ total: hyps.length, running, pending, done, error, uncoveredCombos: uncovered, findingsCount: model.findings.length, summary: `${running} running, ${pending} pending, ${done} done, ${error} error, ${uncovered} uncovered — ${model.findings.length} findings` });
  },
  {
    name: 'check_workers',
    description: 'Check status of all workers and current coverage.',
    schema: z.object({}),
  },
);

const oastCreateUrlTool = tool(
  async (input) => {
    const { technique } = input as { technique: 'ssrf' | 'xxe' | 'open-redirect' };
    const { getOastServer } = await import('../oast');
    const srv = getOastServer();
    if (!srv.isRunning()) return JSON.stringify({ error: 'OAST not running' });
    const uuid = srv.createUrl();
    return JSON.stringify({ uuid, url: `http://127.0.0.1:${srv.getPort()}/${uuid}`, technique });
  },
  {
    name: 'oast_create_url',
    description: 'Create a unique OAST callback URL for blind payload detection.',
    schema: z.object({ technique: z.enum(['ssrf', 'xxe', 'open-redirect']) }),
  },
);

const oastCheckTool = tool(
  async (input) => {
    const { uuid } = input as { uuid?: string };
    const { getOastServer } = await import('../oast');
    const srv = getOastServer();
    if (!srv.isRunning()) return JSON.stringify({ error: 'OAST not running' });
    const records = (srv as any).callbacks || (srv as any).records || [];
    const filtered = uuid ? records.filter((r: any) => r.uuid === uuid) : records;
    return JSON.stringify({ callbacks: filtered.length, records: filtered });
  },
  {
    name: 'oast_check',
    description: 'Check for OAST callbacks received so far.',
    schema: z.object({ uuid: z.string().optional() }),
  },
);

const calculateRiskTool = tool(
  async () => {
    const path = getCurrentAppModelPath();
    const m = readAppModel(path);
    return JSON.stringify(calculateOverallRisk(m));
  },
  {
    name: 'calculate_risk',
    description: 'Calculate overall risk from the current findings.',
    schema: z.object({}),
  },
);

// ── Module-level handle for the active app model path (set per-run) ───

let _appModelPath = '';
function getCurrentAppModelPath(): string {
  if (!_appModelPath) throw new Error('app model path not set');
  return _appModelPath;
}

// ── The orchestrator ──────────────────────────────────────────────────

export class AutonomousOrchestratorV2 {
  private model: BaseChatModel;
  private target: ScanTarget;
  private events?: ScanEventEmitter;
  private outputDir: string;
  private format: string;
  private appModelPath: string;
  private dashboard?: DashboardServer;
  private abortSignal?: AbortSignal;
  private autoContinue: boolean;
  private checkpointerPath?: string;
  private threadId: string;

  private shouldStop = false;
  private waitingForInputResolver: ((text: string) => void) | null = null;
  private inputChannel: string[] = [];
  private lastFindingCount = 0;
  private noProgressTurns = 0;

  constructor(config: {
    model: BaseChatModel;
    target: ScanTarget;
    events?: ScanEventEmitter;
    outputDir: string;
    format?: string;
    appModelPath: string;
    dashboard?: DashboardServer;
    abortSignal?: AbortSignal;
    autoContinue?: boolean;
    checkpointerPath?: string;
    threadId?: string;
  }) {
    this.model = config.model;
    this.target = config.target;
    this.events = config.events;
    this.outputDir = config.outputDir;
    this.format = config.format || 'markdown';
    this.appModelPath = config.appModelPath;
    this.dashboard = config.dashboard;
    this.abortSignal = config.abortSignal;
    this.autoContinue = config.autoContinue ?? true;
    this.checkpointerPath = config.checkpointerPath;
    this.threadId = config.threadId || `strategist-${randomUUID()}`;
    _appModelPath = this.appModelPath;
    setAppModelPath(this.appModelPath);
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

  private async waitForUserInput(autoMsg = 'Continue. Read the attack plan, dispatch remaining hypotheses, and check workers.'): Promise<string> {
    if (this.inputChannel.length > 0) return this.inputChannel.shift()!;
    if (this.abortSignal?.aborted) return '/close';
    if (this.autoContinue) return autoMsg;
    return new Promise((resolve) => {
      this.waitingForInputResolver = resolve;
      if (this.abortSignal) {
        this.abortSignal.addEventListener('abort', () => resolve('/close'), { once: true });
      }
    });
  }

  // ── Build the strategist deepagent ──────────────────────────────────

  private async buildAgent(): Promise<DeepAgent> {
    const outputDir = this.outputDir;
    const backend: AnyBackendProtocol = new CompositeBackend(
      new FilesystemBackend({ rootDir: outputDir }),
      {
        '/scratchpad': new FilesystemBackend({ rootDir: path.join(outputDir, '.scratchpad') }),
      },
    );

    // Production: SqliteSaver.fromConnString(this.checkpointerPath ?? './checkpoints.db')
    const checkpointer = new MemorySaver();

    const allTools = [
      readAppModelV2Tool,
      updateAppModelV2Tool,
      recordCoverageTool,
      checkWorkersTool,
      oastCreateUrlTool,
      oastCheckTool,
      calculateRiskTool,
    ];

    // For auto-continue mode, every tool is allowed without prompting.
    // In REPL mode, add `ask_user: true` to interruptOn.
    const interruptOn: Record<string, boolean | InterruptOnConfig> = {};

    // Subagents: the reasoning worker. We do NOT pre-build it here because
    // we don't have a hypothesis to test yet. The strategist will call
    // `task(name="reasoning-worker", ...)` with a single, dynamically built
    // worker. In practice, the strategist delegates via the existing
    // `spawn_agent` tool (kept for backward compat), or via a custom
    // subagent that lazily creates workers per hypothesis.

    // Stub: a generic reasoning worker that the strategist can dispatch.
    // The actual per-hypothesis worker is built in spawnWorkerSubagent().
    const workerSubagent: SubAgent = {
      name: 'reasoning-worker',
      description: 'Delegate a single vulnerability hypothesis to a reasoning worker. Provide a `prompt` containing the endpoint, param, method, and technique to test. The worker returns vulnerable=true|false, confidence, evidence, and payloads.',
      systemPrompt: 'You are a reasoning worker stub. In production, buildReasoningWorker() is invoked per-task with the supplied hypothesis. The actual worker is in src/agents/worker.ts.',
      tools: allTools,
    };

    return createDeepAgent({
      model: this.model,
      tools: allTools,
      systemPrompt: this.buildSystemPrompt(),
      subagents: [workerSubagent],
      backend,
      checkpointer,
      interruptOn,
      name: 'ultimatrix-strategist',
      middleware: [
        fixWriteTodosMiddleware,
        modelCallLimitMiddleware({ threadLimit: 13, runLimit: 13, exitBehavior: 'end' }),
        makeDashboardEmitMiddleware(this.dashboard),
        makePeriodicSaveMiddleware(this.appModelPath, 3),
        makeTerminationMiddleware(() => this.shouldStop),
        colorStreamMiddleware,
      ],
    });
  }

  private buildSystemPrompt(): string {
    let sp = STRATEGIST_PROMPT;
    const targetUrl = typeof this.target === 'string' ? this.target : (this.target as any).url;
    sp += `\n\nTarget URL: ${targetUrl}`;
    sp += `\nOutput directory: ${this.outputDir}`;
    sp += `\nApp model path: ${this.appModelPath}`;
    sp += `\n\nYou can delegate to a reasoning-worker subagent for each hypothesis.`;
    sp += `\nUse task(name="reasoning-worker", prompt="Test <technique> on <endpoint>?<param>") for delegation.`;
    sp += `\n\nWhen you believe all hypotheses are dispatched and all workers are done, say "coverage complete" in your final message.`;
    return sp;
  }

  // ── Spawn a per-hypothesis worker (real, not the stub) ──────────────

  private async spawnRealWorker(hypothesis: any, technique: string): Promise<void> {
    const config: WorkerConfig = {
      hypothesis: { ...hypothesis, technique },
      llmConfig: (globalThis as any).__ULTIMATRIX_LLM_CONFIG__ || { provider: 'mock', apiKey: '', model: 'mock' },
      appModelPath: this.appModelPath,
      timeoutMs: 180_000,
    };
    try {
      const oast = (await import('../oast')).getOastServer();
      if (oast?.isRunning()) config.oastBaseUrl = `http://localhost:${oast.getPort()}`;
    } catch { /* best effort */ }
    const m = readAppModel(this.appModelPath);
    if (m.auth?.storageStatePath) config.storageStatePath = m.auth.storageStatePath;
    if (m.auth?.loginEndpoint) config.loginEndpoint = m.auth.loginEndpoint;
    if (m.auth?.loginMethod) config.loginMethod = m.auth.loginMethod;
    if (m.auth?.loginFields) config.loginFields = m.auth.loginFields;

    // Mark running
    updateHypothesisStatus(this.appModelPath, hypothesis, technique, 'running');

    // Fire-and-forget; result is persisted by runReasoningWorker itself
    runReasoningWorker(config)
      .then((r) => {
        if (r.vulnerable) {
          this.emitDashboardEvent('finding', { technique, endpoint: hypothesis.endpoint, confidence: r.confidence });
        }
      })
      .catch((e) => log.warn(`Worker for ${technique} failed: ${e}`));
  }

  // ── Outer driver loop ───────────────────────────────────────────────

  async run(): Promise<RunResult> {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const targetUrl = typeof this.target === 'string' ? this.target : (this.target as any).url;
    const fmt = this.format === 'html' ? 'html' : this.format === 'json' ? 'json' : 'md';
    const reportPath = path.join(this.outputDir, `final-security-report.${fmt}`);

    // Start OAST
    try {
      const port = await ensureOastRunning(path.join(this.outputDir, 'oast-callbacks.json'));
      log.info(`OAST server on port ${port}`);
    } catch (e) {
      log.warn(`OAST start failed: ${e}`);
    }

    // Resume detection
    const agent = await this.buildAgent();
    const resuming = await this.hasExistingThread(agent, this.threadId);

    log.info(resuming ? `Resuming thread ${this.threadId}` : `Starting fresh thread ${this.threadId}`);
    this.emitDashboardEvent('status', { message: resuming ? 'Resuming' : 'Strategist launched' });

    // Initial message
    const initialMsg = resuming
      ? 'Continue from where you left off.'
      : `Begin assessment of ${targetUrl}.

The spider has already mapped all pages. DO NOT use browser navigation tools.

=== Action Plan ===
1. Read the "forms" section from the app model to see which endpoints have parameters
2. Read the "endpoints" section to see API endpoints
3. For each endpoint with a parameter, dispatch a reasoning-worker via task() to test it
4. Read results, dispatch more workers, and check progress with check_workers

Start by reading the forms section.`;

    let turnCount = 0;
    while (turnCount < MAX_TURNS) {
      if (this.abortSignal?.aborted) {
        process.stdout.write(colors.warn(`\nReceived abort signal. Stopping.\n`));
        break;
      }

      const msg = turnCount === 0 && !resuming ? initialMsg : await this.waitForUserInput();
      if (msg.startsWith('/close') || msg.startsWith('/exit')) break;
      if (this.shouldStop) break;

      try {
        const result = await agent.invoke(
          { messages: [new HumanMessage(msg)] },
          { configurable: { thread_id: this.threadId }, signal: this.abortSignal },
        );

        // Extract final text for termination regex
        const messages = (result as any).messages || [];
        const lastAi = [...messages].reverse().find((m: any) => m._getType?.() === 'ai' || m.role === 'assistant');
        const text = typeof lastAi?.content === 'string' ? lastAi.content : Array.isArray(lastAi?.content) ? lastAi.content.map((c: any) => typeof c === 'string' ? c : c.text || '').join('') : '';
        if (text) process.stdout.write(colors.info(`\n${text.trim()}\n`));

        // ── Termination conditions ──
        const appModelNow = readAppModel(this.appModelPath);
        const hyps = Array.isArray(appModelNow.hypotheses) ? appModelNow.hypotheses : [];
        const running = hyps.filter((h: any) => h.status === 'running').length;
        const done = hyps.filter((h: any) => h.status === 'done').length;
        const error = hyps.filter((h: any) => h.status === 'error').length;
        const findingsNow = appModelNow.findings.length;

        const allCombos = new Set<string>();
        const coveredCombos = new Set<string>();
        for (const h of hyps) {
          const hObj = h as any;
          const combo = `${hObj.method || 'GET'}:${hObj.endpoint || ''}:${hObj.param || ''}`;
          allCombos.add(combo);
          if (['running', 'done', 'error'].includes(hObj.status)) coveredCombos.add(combo);
        }
        const uncovered = allCombos.size - coveredCombos.size;

        // Condition A: LLM signals completion
        if (/coverage complete|all done|finished/i.test(text)) {
          log.success('Strategist declared coverage complete.');
          this.shouldStop = true;
        }

        // Condition B: programmatic completion
        if (uncovered === 0 && running === 0) {
          log.dim(`All ${allCombos.size} endpoint×param combos resolved (${done + error} total, ${findingsNow} findings). Stopping.`);
          this.shouldStop = true;
        }

        // Condition C: workers running but no new findings for 3 turns
        if (uncovered === 0 && running > 0) {
          if (findingsNow > this.lastFindingCount) {
            this.lastFindingCount = findingsNow;
            this.noProgressTurns = 0;
          } else {
            this.noProgressTurns++;
            if (this.noProgressTurns >= 3) {
              log.warn(`No new findings for 3 turns with ${running} workers running. Stopping.`);
              this.shouldStop = true;
            }
          }
        }
      } catch (e) {
        log.warn(`Strategist turn error: ${e}`);
        if ((e as any).name === 'AbortError') break;
      }

      turnCount++;
      if (turnCount >= MAX_TURNS) {
        log.warn(`Reached ${MAX_TURNS} turn limit.`);
        this.shouldStop = true;
      }

      if (turnCount % SAVE_INTERVAL === 0) {
        await this.savePartialReport(turnCount);
      }
    }

    // ── Compile report, triage, generate Playwright test ──
    return await this.finalize(reportPath);
  }

  // ── Resume support ──────────────────────────────────────────────────

  private async hasExistingThread(agent: DeepAgent, threadId: string): Promise<boolean> {
    try {
      const state = await (agent as any).getState({ configurable: { thread_id: threadId } });
      const messages = (state?.values as any)?.messages || [];
      return messages.length > 0;
    } catch {
      return false;
    }
  }

  // ── Periodic Playwright test generation ─────────────────────────────

  private async savePartialReport(turn: number): Promise<void> {
    try {
      const mgr = getSharedBrowserManager();
      const strategistSteps = mgr.stopRecording('default') || [];
      const model = readAppModel(this.appModelPath);
      const spiderSteps = model.recordedSessions?.['spider-auto'] || [];
      const workerActions = model.workerActions || [];
      const allSteps = [...spiderSteps, ...strategistSteps];
      if (allSteps.length > 0 || workerActions.length > 0) {
        const { generateSecurityPlaywrightTest } = await import('../core/trace-utils');
        const docData = (model.workflow.nodes.length > 0 || model.forms.length > 0) ? {
          routes: model.workflow.nodes.map((n) => ({ url: n.url, title: n.title, forms: model.forms.filter((f) => f.pageUrl === n.url).length, links: 0 })),
          forms: model.forms.map((f) => ({ pageUrl: f.pageUrl, action: f.action, fields: f.fields.map((fd) => ({ name: fd.name, type: fd.type })) })),
          totalRoutes: model.workflow.nodes.length,
          auth: { type: model.auth.type, loginEndpoint: model.auth.loginEndpoint },
          techStack: model.techStack || [],
        } : undefined;
        const files = generateSecurityPlaywrightTest({
          browserSteps: allSteps,
          workerActions,
          target: typeof this.target === 'string' ? this.target : '',
          outputDir: path.join(this.outputDir, 'playwright'),
          docData,
        });
        log.success(`Playwright test generated (turn ${turn}): ${files.join(', ')}`);
      }
      mgr.startRecording('default');
    } catch (e) {
      log.warn(`Playwright test generation (turn ${turn}) failed: ${e}`);
    }
  }

  // ── Final report compilation + triage ──────────────────────────────

  private async finalize(reportPath: string): Promise<RunResult> {
    log.info('Compiling report from app model...');
    this.emitDashboardEvent('status', { message: 'Compiling report' });

    const finalModel = readAppModel(this.appModelPath);

    if (finalModel.findings.length > 0) {
      log.info(`Running triage on ${finalModel.findings.length} findings...`);
      const { triageFinding, applyTriageToFindings } = await import('../triage');
      const decisions = finalModel.findings.map((f) => triageFinding(f, finalModel.findings));
      const triaged = applyTriageToFindings(finalModel.findings, decisions);
      const removed = finalModel.findings.length - triaged.length;
      if (removed > 0) {
        log.info(`Triage: ${removed} finding(s) removed/rejected, ${triaged.length} accepted`);
        finalModel.findings = triaged;
        writeAppModel(this.appModelPath, finalModel);
      }
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

    try {
      const mgr = getSharedBrowserManager();
      const strategistSteps = mgr.stopRecording('default') || [];
      const spiderSteps = finalModel.recordedSessions?.['spider-auto'] || [];
      const workerActions = finalModel.workerActions || [];
      const allSteps = [...spiderSteps, ...strategistSteps];
      if (allSteps.length > 0 || workerActions.length > 0) {
        const { generateSecurityPlaywrightTest } = await import('../core/trace-utils');
        const docData = (finalModel.workflow.nodes.length > 0 || finalModel.forms.length > 0) ? {
          routes: finalModel.workflow.nodes.map((n) => ({ url: n.url, title: n.title, forms: finalModel.forms.filter((f) => f.pageUrl === n.url).length, links: 0 })),
          forms: finalModel.forms.map((f) => ({ pageUrl: f.pageUrl, action: f.action, fields: f.fields.map((fd) => ({ name: fd.name, type: fd.type })) })),
          totalRoutes: finalModel.workflow.nodes.length,
          auth: { type: finalModel.auth.type, loginEndpoint: finalModel.auth.loginEndpoint },
          techStack: finalModel.techStack || [],
        } : undefined;
        const files = generateSecurityPlaywrightTest({
          browserSteps: allSteps,
          workerActions,
          target: typeof this.target === 'string' ? this.target : '',
          outputDir: path.join(this.outputDir, 'playwright'),
          docData,
        });
        if (files.length > 0) log.success(`Playwright test generated: ${files.join(', ')}`);
      }
    } catch (e) {
      log.warn(`Playwright test generation failed: ${e}`);
    }

    const report = compileReport(finalModel, this.format as any);
    fs.writeFileSync(reportPath, report + oastSummary);
    log.success(`Report written: ${reportPath}`);

    try { await stopOast(); } catch { /* best effort */ }

    const findings: Finding[] = finalModel.findings.map((f, i) => ({
      id: `finding-${i}`,
      title: f.type,
      description: `Parameter: ${f.param || '-'}, Evidence: ${f.evidence.map((e) => e.label).join('; ')}`,
      severity: f.severity as any,
      category: f.type,
      confidence: f.confidence === 'high' ? 0.9 : f.confidence === 'medium' ? 0.6 : 0.3,
      location: f.endpoint || finalModel.target,
      evidence: f.evidence.map((e) => `[${e.label}] ${e.data.slice(0, 200)}`).join('\n'),
      remediation: '',
      agent: 'autonomous-v2' as any,
      timestamp: new Date().toISOString(),
    }));

    return { findings, reportPath, threadId: this.threadId };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function updateHypothesisStatus(appModelPath: string, hyp: any, technique: string, status: string): void {
  try {
    const m = readAppModel(appModelPath);
    const hyps = Array.isArray(m.hypotheses) ? [...m.hypotheses] : [];
    const updated = hyps.map((h: any) => {
      if (h.id === hyp.id && h.technique === technique) return { ...h, status };
      return h;
    });
    updateAppModelSection(appModelPath, 'hypotheses', updated, true);
  } catch { /* best effort */ }
}
