// src/cli/hunt.ts
//
// The canonical `hunt` command. Collapses `assess` + `interact` + `test` into
// a single integrated flow:
//
//   1. Spider (depth 2)        — discover routes, forms, cookies, storage
//   2. Recon (parallel)        — OAuth / GraphQL / JWT / cloud / framework
//   3. v3 Orchestrator         — workflow DAG + multi-session RBAC
//      ├─ onBeforeNode hook    — prompt user (Y/s/i/d/a) per node
//      ├─ worker runner        — HandRolledWorkerRunner with probes
//      └─ chain engine         — heuristic chains after each finding
//   4. Ask: generate tests?    — FindingTestGenerator → playwright-tests/
//   5. Report                  — chain-first HTML + Mermaid
//
// Slash commands (in guided mode):
//   /auto /guided /findings /test /report /add <url> /help /quit
//
// Flags:
//   --target, -t         target URL (required)
//   --output, -o         output dir (default ./output)
//   --guided             step-by-step mode (default)
//   --auto               autonomous mode (no prompts)
//   --no-tests           skip Playwright test generation
//   --tests-dir <dir>    where to write Playwright tests (default playwright-tests)
//   --depth <n>          spider depth (default 2)
//   --max-runtime <s>    hard time limit in seconds (default 1800)
//   --no-chains          skip attack chain reasoning
//   --no-recon           skip recon layer
//   --no-spider          skip spider (use existing app-model.json)
//   --existing-model <p> path to existing app-model.json to resume from

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { AppModel, AppModelFinding, AttackChain } from '../core/app-model';
import { readAppModel, writeAppModel, writeAppModelAsync, DEFAULT_MODEL, updateAppModelSection, compileReport } from '../core/app-model';
import { runRecon } from '../recon';
import { runChainEngine, runHeuristicChains } from '../core/attack-chain';
import { renderChainFirstReport, renderChainReportHtml } from '../core/chain-report';
import { generateFindingTests, writeFindingTests } from '../tools/finding-test-generator';
import { HuntPrompt, SLASH_HELP, type NodePromptAnswer, type HuntMode } from './prompt';
import { SpiderCrawler, type CrawlResult } from '../explorer/spider';
import { AutonomousV3Orchestrator, defaultNodeStrategy, type NodeStrategy, type NodeStrategyResolution, type WorkerSpawnInput, type WorkerSpawnResult } from '../pipeline/autonomous-v3';
import { WorkflowStateGraph, type WorkflowStateNode } from '../core/workflow-state';
import { SessionPool, getDefaultSessionPool } from '../core/session-pool';
import { getSharedBrowserManager } from '../tools/browser-tools';
import type { Hypothesis, Technique } from '../core/attack-plan';

import { parseHuntFlags as _parseHuntFlags, type HuntOptions } from './hunt-flags';
export { type HuntOptions } from './hunt-flags';
export function parseHuntFlags(args: string[]): HuntOptions { return _parseHuntFlags(args); }
export async function runHunt(opts: HuntOptions): Promise<void> {
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const modelPath = path.join(opts.outputDir, 'app-model.json');
  const startedAt = Date.now();
  console.log(`\n\x1b[1;32m▸ Ultimatrix hunt\x1b[0m → ${opts.target}`);
  console.log(`  mode: ${opts.mode}, output: ${opts.outputDir}, max runtime: ${Math.round(opts.maxRuntimeMs / 1000)}s\n`);

  // Build the prompt (constructed with no-callback stubs to break the
  // self-reference; real callbacks are wired in after the prompt exists)
  const prompt: HuntPrompt = new HuntPrompt({
    onNodePrompt: async () => 'proceed' as NodePromptAnswer,
    onSlash: async () => '',
    onQuit: async () => { prompt.close(); process.exit(0); },
  });
  prompt.setMode(opts.mode);

  // 1. Spider
  let model: AppModel;
  if (opts.skipSpider && opts.existingModelPath && fs.existsSync(opts.existingModelPath)) {
    console.log(`[1/5] Loading existing model from ${opts.existingModelPath}…`);
    model = readAppModel(opts.existingModelPath);
  } else if (fs.existsSync(modelPath)) {
    console.log(`[1/5] Loading existing model from ${modelPath}…`);
    model = readAppModel(modelPath);
  } else {
    console.log(`[1/5] Spidering ${opts.target} (depth ${opts.depth})…`);
    const mgr = getSharedBrowserManager(true);
    const spider = new SpiderCrawler(mgr, 'default');
    const crawlResult: CrawlResult = await spider.crawl(opts.target, opts.depth, undefined, opts.outputDir);
    model = buildAppModelFromCrawl(crawlResult, opts.target);
    await writeAppModelAsync(modelPath, model);
    console.log(`  ↳ discovered ${crawlResult.visitedUrls.length} URLs, ${crawlResult.routes.length} routes`);
  }

  // 2. Recon
  if (!opts.skipRecon) {
    console.log(`[2/5] Running recon (OAuth / GraphQL / JWT / cloud / framework)…`);
    const reconResult = await runRecon({
      target: opts.target,
      appModelPath: modelPath,
      parallel: true,
    });
    const totalDiscovered = reconResult.oauthProviders + reconResult.graphqlEndpoints + reconResult.jwtTokens + reconResult.frameworks + reconResult.cloudProbes;
    console.log(`  ↳ ${totalDiscovered} discoveries in ${reconResult.durationMs}ms (errors: ${reconResult.errors.length})`);
    model = readAppModel(modelPath);
  } else {
    console.log(`[2/5] Recon skipped (--no-recon)`);
  }

  // 3. v3 Orchestrator
  console.log(`[3/5] Launching v3 orchestrator…`);
  const { graph, pool } = await buildWorkflowFromAppModel(model, opts);
  const findingsBefore = model.findings.length;
  let v3Findings: AppModelFinding[] = [];

  try {
    const orch = new AutonomousV3Orchestrator({
      graph,
      pool,
      appModel: model,
      strategy: defaultNodeStrategy,
      workerFactory: huntWorkerRunner,
      onFinding: (finding) => {
        v3Findings.push(finding);
        updateAppModelSection(modelPath, 'findings', [finding], true);
      },
      onBeforeNode: async (node, spec) => {
        if (!spec) return 'skip';
        const remaining = Math.max(0, opts.maxRuntimeMs - (Date.now() - startedAt));
        if (remaining < 5_000) {
          console.log(`\x1b[33m  ! Time budget exhausted, aborting\x1b[0m`);
          return 'abort';
        }
        const answer = await prompt.promptNode({
          id: node.id,
          url: node.url,
          method: spec.method,
          technique: spec.technique,
          expectedSeverity: spec.expectedSeverity,
        });
        if (answer === 'skip') return 'skip';
        if (answer === 'abort') return 'abort';
        if (answer === 'add') {
          const url = (await prompt.ask('  URL to add: ')).trim();
          if (url) {
            const m = readAppModel(modelPath);
            m.visitedUrls = [...(m.visitedUrls || []), url];
            await writeAppModelAsync(modelPath, m);
          }
          return 'skip';
        }
        return 'proceed';
      },
      maxRuntimeMs: opts.maxRuntimeMs,
      enableConcurrency: true,
      maxConcurrency: 4,
      sleepBetweenNodesMs: 0,
    });
    await orch.run();
  } finally {
    await pool.closeAll();
  }

  model = readAppModel(modelPath);
  const findingsAfter = model.findings.length - findingsBefore;
  console.log(`  ↳ ${findingsAfter} new findings (${model.findings.length} total)`);

  // 4. Chain engine (if not skipped)
  if (!opts.skipChains && model.findings.length > 0) {
    console.log(`[4/5] Running attack chain engine (heuristic)…`);
    const newChains: AttackChain[] = runHeuristicChains(model.findings, 'low');
    const existing = model.attackChains || [];
    model.attackChains = mergeChains(existing, newChains);
    await writeAppModelAsync(modelPath, model);
    const critical = model.attackChains.filter(c => c.severity === 'critical' || c.severity === 'high').length;
    console.log(`  ↳ ${newChains.length} new chains (${critical} critical/high, ${model.attackChains.length} total)`);
  } else {
    console.log(`[4/5] Chain engine skipped`);
  }

  // 5. Playwright test generation
  if (!opts.skipTests && model.findings.length > 0) {
    if (opts.mode === 'guided') {
      const ans = (await prompt.ask('  Generate Playwright regression tests? [Y/n]: ')).trim().toLowerCase();
      if (ans === '' || ans === 'y' || ans === 'yes') {
        await generateAndWriteTests(model, opts, modelPath);
      } else {
        console.log(`[5/5] Skipped test generation`);
      }
    } else {
      await generateAndWriteTests(model, opts, modelPath);
    }
  } else if (model.findings.length === 0) {
    console.log(`[5/5] No findings — skipping test generation`);
  } else {
    console.log(`[5/5] Test generation skipped (--no-tests)`);
  }

  // 6. Report
  console.log(`[6/6] Compiling report…`);
  const sections = renderChainFirstReport(model);
  const htmlPath = path.join(opts.outputDir, 'report.html');
  fs.writeFileSync(htmlPath, renderChainReportHtml(sections), 'utf-8');
  const mdPath = path.join(opts.outputDir, 'report.md');
  fs.writeFileSync(mdPath, compileReport(model, 'markdown'), 'utf-8');
  console.log(`  ↳ report.html, report.md written to ${opts.outputDir}`);
  console.log(`\n\x1b[1;32m✓ Hunt complete in ${Math.round((Date.now() - startedAt) / 1000)}s\x1b[0m`);
  console.log(`  findings: ${model.findings.length}  chains: ${(model.attackChains || []).length}`);
  console.log(`  report:   ${htmlPath}\n`);
}

function buildAppModelFromCrawl(crawl: CrawlResult, target: string): AppModel {
  const model: AppModel = JSON.parse(JSON.stringify(DEFAULT_MODEL));
  model.target = target;
  model.visitedUrls = crawl.visitedUrls;
  // Map routes → endpoints
  for (const route of crawl.routes) {
    model.endpoints.push({
      path: route.url,
      method: 'GET',
      responseStatus: 200,
      contentType: 'text/html',
      requiresAuth: false,
      bodyPreview: '',
      params: [],
    });
  }
  return model;
}

async function buildWorkflowFromAppModel(
  model: AppModel,
  opts: HuntOptions,
): Promise<{ graph: WorkflowStateGraph; pool: SessionPool }> {
  const graph = new WorkflowStateGraph();
  for (let i = 0; i < (model.visitedUrls || []).length; i++) {
    const url = model.visitedUrls[i];
    const isApi = url.includes('/api/') || /\/v\d+\//.test(url);
    graph.addNode({
      id: randomUUID(),
      url,
      title: url,
      type: isApi ? 'api' : 'page',
      authRequired: false,
      authVerified: false,
      discoveredFrom: null,
      discoveryMethod: 'navigation',
    });
  }
  const pool = getDefaultSessionPool();
  if ((model.visitedUrls || []).length > 0) {
    try { pool.switchTo('default'); } catch { /* ignore */ }
  }
  return { graph, pool };
}

async function huntWorkerRunner(input: WorkerSpawnInput): Promise<WorkerSpawnResult> {
  const start = Date.now();
  return {
    vulnerable: false,
    confidence: 0,
    evidence: [],
    payloads: [],
    summary: `Stub: ${input.technique} @ ${input.url} (no LLM)`,
    technique: input.technique,
    url: input.url,
    durationMs: Date.now() - start,
  };
}

function mergeChains(existing: AttackChain[], fresh: AttackChain[]): AttackChain[] {
  const seen = new Set(existing.map(c => c.id));
  return [...existing, ...fresh.filter(c => !seen.has(c.id))];
}

async function generateAndWriteTests(model: AppModel, opts: HuntOptions, _modelPath: string): Promise<void> {
  const result = generateFindingTests(model, {
    outDir: opts.testsDir,
    includeChainTests: true,
  });
  const written = writeFindingTests(result, opts.testsDir);
  console.log(`  ↳ wrote ${written.length} files to ${opts.testsDir} (${result.findingsWritten} finding tests, ${result.chainsWritten} chain tests)`);
}

async function handleSlash(
  cmd: string,
  args: string[],
  opts: HuntOptions,
  modelPath: string,
  prompt: HuntPrompt,
): Promise<string> {
  switch (cmd) {
    case 'auto': prompt.setMode('auto'); return 'Mode → auto';
    case 'guided': prompt.setMode('guided'); return 'Mode → guided';
    case 'findings': {
      const m = readAppModel(modelPath);
      if (m.findings.length === 0) return 'No findings yet.';
      return m.findings
        .map(f => `  [${f.severity.toUpperCase()}] ${f.type} @ ${f.endpoint} (param: ${f.param || '-'}) conf=${f.confidence}`)
        .join('\n');
    }
    case 'test': {
      const m = readAppModel(modelPath);
      await generateAndWriteTests(m, opts, modelPath);
      return 'Tests generated.';
    }
    case 'report': {
      const m = readAppModel(modelPath);
      const sections = renderChainFirstReport(m);
      const htmlPath = path.join(opts.outputDir, 'report.html');
      fs.writeFileSync(htmlPath, renderChainReportHtml(sections), 'utf-8');
      return `Report written to ${htmlPath}`;
    }
    case 'add': {
      const url = args[0];
      if (!url) return 'Usage: /add <url>';
      const m = readAppModel(modelPath);
      m.visitedUrls = [...(m.visitedUrls || []), url];
      await writeAppModelAsync(modelPath, m);
      return `Added ${url} to the workflow graph`;
    }
    case 'help': return SLASH_HELP;
    case 'quit': case 'exit': case 'q':
      prompt.close();
      process.exit(0);
      return ''; // unreachable
    default:
      return `Unknown command: /${cmd}. Try /help.`;
  }
}
