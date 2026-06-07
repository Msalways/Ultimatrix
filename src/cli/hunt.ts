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
import { HuntPrompt, SLASH_HELP } from './prompt';
// HuntPrompt is exported from src/index.ts; the hunt CLI uses the
// InteractiveHuntSession's own HuntPrompt-driven REPL instead of a
// top-level REPL. The SLASH_HELP is used by handleSlash.
import { InteractiveHuntSession } from './interactive-session';
import { SpiderCrawler, type CrawlResult } from '../explorer/spider';
import { AutonomousV3Orchestrator, defaultNodeStrategy, type NodeStrategy, type NodeStrategyResolution, type WorkerSpawnInput, type WorkerSpawnResult } from '../pipeline/autonomous-v3';
import { WorkflowStateGraph, type WorkflowStateNode } from '../core/workflow-state';
import { SessionPool, getDefaultSessionPool } from '../core/session-pool';
import { getSharedBrowserManager } from '../tools/browser-tools';
import type { Hypothesis, Technique } from '../core/attack-plan';
import type { AppModelEndpoint } from '../core/app-model';
import type { PrimitiveContext } from '../primitives/types';
import { LiveTestWriter } from '../codegen/live-writer';
import { HuntCore } from '../hunt/core';
import { wireHuntCore } from './hunt-core-wiring';

import { parseHuntFlags as _parseHuntFlags, type HuntOptions } from './hunt-flags';
import { deriveShortUrlLabel } from './url-label';
export { type HuntOptions } from './hunt-flags';
export function parseHuntFlags(args: string[]): HuntOptions { return _parseHuntFlags(args); }
// `hlog` writes a status line to BOTH the terminal (with ANSI
// colors) and the v4 HuntCore log stream. The v4 log stream is
// what the web UI subscribes to via the `onHuntCore` hook, so
// every status message the user would see in their terminal
// also appears in the web UI's Live log panel. We strip ANSI
// escapes before forwarding to the core so the log payload is
// plain text.
//
// `hlogWiring` is set by `runHunt` after the HuntCore is wired.
// Until then `hlog` is a no-op for the v4 stream (terminal still
// works). Module-scope so helpers like `buildWorkflowFromAppModel`
// can use the same sink.
type Wiring = ReturnType<typeof wireHuntCore>;
let hlogWiring: Wiring | null = null;
const ANSI = /\x1b\[[0-9;]*m/g;
export function hlog(level: 'info' | 'warn' | 'error' | 'debug', line: string): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (hlogWiring) {
    const plain = line.replace(ANSI, '');
    hlogWiring.onLog(level, plain);
  }
}

export async function runHunt(opts: HuntOptions): Promise<void> {
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const modelPath = path.join(opts.outputDir, 'app-model.json');
  const startedAt = Date.now();
  hlog('info', `\n\x1b[1;32m▸ Ultimatrix hunt\x1b[0m → ${opts.target}`);
  hlog('info', `  output: ${opts.outputDir}, max runtime: ${opts.maxRuntimeMs === 0 ? 'unlimited' : `${Math.round(opts.maxRuntimeMs / 1000)}s`}\n`);

  // Block 21: default LLM token sink. If the caller didn't supply one
  // (e.g. the user just ran `ultimatrix hunt -t https://xss-game...`),
  // we write dim chunks to stderr so the operator sees the agent think
  // in real time. The web UI overrides this with a WebSocket forwarder.
  // Gated on a TTY: in non-TTY contexts (CI, piped output) we don't
  // want to spam a half-colored stream into a log file. Streaming
  // still happens — it just goes nowhere the user can see.
  if (!opts.onLLMToken) {
    if (process.stderr.isTTY) {
      let currentLabel: string | null = null;
      opts.onLLMToken = (label, chunk) => {
        if (label !== currentLabel) {
          if (currentLabel !== null) process.stderr.write('\n');
          process.stderr.write(`\x1b[2;36m▸ ${label}\x1b[0m `);
          currentLabel = label;
        }
        process.stderr.write(`\x1b[2m${chunk}\x1b[0m`);
      };
    } else {
      // Non-TTY: collect to a counter so a final line says "streamed N
      // tokens from K calls" — useful evidence in CI logs.
      let tokenCount = 0;
      let callCount = 0;
      const seen = new Set<string>();
      opts.onLLMToken = (label) => {
        tokenCount += 1;
        if (!seen.has(label)) { callCount += 1; seen.add(label); }
      };
      // Defer the summary line to the very end of the hunt.
      process.once('beforeExit', () => {
        if (tokenCount > 0) hlog('info', `  · LLM stream: ${callCount} calls, ${tokenCount} tokens`);
      });
    }
  }

  // No top-level HuntPrompt here — the InteractiveHuntSession runs its
  // own HuntPrompt-driven REPL inside. The slash commands below
  // (/plan, /attack, /test, /report) are dispatched from that REPL
  // via handleSlash.
  const prompt: HuntPrompt | null = null;

  // 1. Spider
  let model: AppModel = JSON.parse(JSON.stringify(DEFAULT_MODEL));
  if (opts.skip.has('spider') && opts.existingModelPath && fs.existsSync(opts.existingModelPath)) {
    hlog('info', `[1/5] Loading existing model from ${opts.existingModelPath}…`);
    model = readAppModel(opts.existingModelPath);
  } else if (fs.existsSync(modelPath) && !opts.skip.has('spider')) {
    const existing = readAppModel(modelPath);
    const existingTarget = (existing as any).target ?? '';
    // Detect stale model: target differs from -t argument
    const targetChanged = existingTarget && existingTarget !== opts.target;
    // OR the model is "empty" — endpoints exist but bodyPreview is missing.
    // The LLM planner needs bodyPreview to identify sinks (e.g. the ?query=
    // search input on xss-game/level1/frame). Without it, the planner
    // defaults to a 'headers' check and finds nothing. A stale-but-empty
    // model is the most common cause of "0 findings on a known-vuln site".
    const endpointsWithBody = (existing.endpoints || []).filter((e: any) => (e.bodyPreview ?? '').length > 50).length;
    const totalEndpoints = (existing.endpoints || []).length;
    const modelIsEmpty = totalEndpoints > 0 && endpointsWithBody === 0;
    if (targetChanged) {
      hlog('info', `[1/5] Stale model detected (was for ${existingTarget}, now scanning ${opts.target}) — re-spidering…`);
    } else if (modelIsEmpty) {
      hlog('info', `[1/5] Existing model has ${totalEndpoints} endpoints but 0 with body preview — re-spidering so the LLM can see sinks…`);
    } else {
      hlog('info', `[1/5] Loading existing model from ${modelPath}…`);
      model = existing;
    }
    if (targetChanged || modelIsEmpty) {
      const mgr = getSharedBrowserManager(true);
      const spider = new SpiderCrawler(mgr, 'default');
      const crawlResult: CrawlResult = await spider.crawl(opts.target, opts.depth, undefined, opts.outputDir);
      const before = new Set((existing.endpoints || []).map((e: any) => e.path || e.url));
      model = buildAppModelFromCrawl(crawlResult, opts.target);
      await writeAppModelAsync(modelPath, model);
      hlog('info', `  ↳ discovered ${crawlResult.visitedUrls.length} URLs, ${crawlResult.routes.length} routes`);
      // Block 19: emit a diff so the user can see what changed.
      const after = new Set((model.endpoints || []).map((e: any) => e.path || e.url));
      const added = [...after].filter((p) => !before.has(p));
      const removed = [...before].filter((p) => !after.has(p));
      if (added.length || removed.length) {
        hlog('info', `  ↳ diff: +${added.length} new endpoint${added.length === 1 ? '' : 's'}, -${removed.length} removed`);
        for (const a of added.slice(0, 10)) hlog('info', `      + ${a}`);
        for (const r of removed.slice(0, 5)) hlog('info', `      - ${r}`);
        if (added.length > 10) hlog('info', `      … and ${added.length - 10} more`);
      }
    }
  } else {
    hlog('info', `[1/5] Spidering ${opts.target} (depth ${opts.depth})…`);
    const mgr = getSharedBrowserManager(true);
    const spider = new SpiderCrawler(mgr, 'default');
    const crawlResult: CrawlResult = await spider.crawl(opts.target, opts.depth, undefined, opts.outputDir);
    model = buildAppModelFromCrawl(crawlResult, opts.target);
    await writeAppModelAsync(modelPath, model);
    hlog('info', `  ↳ discovered ${crawlResult.visitedUrls.length} URLs, ${crawlResult.routes.length} routes`);
  }

  // 2. Recon
  if (!opts.skip.has('recon')) {
    hlog('info', `[2/5] Running recon (OAuth / GraphQL / JWT / cloud / framework)…`);
    const reconResult = await runRecon({
      target: opts.target,
      appModelPath: modelPath,
      parallel: true,
    });
    const totalDiscovered = reconResult.oauthProviders + reconResult.graphqlEndpoints + reconResult.jwtTokens + reconResult.frameworks + reconResult.cloudProbes;
    hlog('info', `  ↳ ${totalDiscovered} discoveries in ${reconResult.durationMs}ms (errors: ${reconResult.errors.length})`);
    model = readAppModel(modelPath);
  } else {
    hlog('info', `[2/5] Recon skipped (--no-recon)`);
  }

  // 3. v3 Orchestrator + Interactive Session
  //
  // Two parallel attack surfaces:
  //   - Orchestrator: attacks the seed URLs from the spider (no user
  //     interaction needed)
  //   - Interactive session: opens a headed browser, runs a terminal
  //     REPL, attacks each URL the user visits, and records manual
  //     actions for a user-flow Playwright spec.
  //
  // Both share the same `app-model.json` findings section.
  //
  // Block 14: a single HuntCore is the source of truth for v4 events.
  // Every v3 finding/primitive/chat/log flows into the core via
  // `wireHuntCore` so the v4 event stream, dedup, and summary are
  // all driven by the same instance.
  hlog('info', `[3/5] Launching orchestrator + interactive session…`);
  const { graph, pool } = await buildWorkflowFromAppModel(model, opts);
  const findingsBefore = model.findings.length;
  let v3Findings: AppModelFinding[] = [];

  // Spin up the HuntCore. It owns dedup (by type+endpoint+param), the
  // v4 event stream, behavioral recording, and the live spec at
  // `output/live.spec.ts`. The v3 workers still write per-node specs
  // at `output/live-{nodeId}.spec.ts`; those are merged by the
  // post-hoc synthesizer (Block 9b.2) after the hunt ends.
  const huntCore = new HuntCore({
    target: opts.target,
    outDir: opts.outputDir,
    llm: await (async () => (await import('../llm/client')).getDefaultLLMClient())(),
    maxRuntimeSeconds: opts.maxRuntimeMs === 0 ? 0 : Math.round(opts.maxRuntimeMs / 1000),
  });
  // Block 21: subscribe to v4 events BEFORE start() so the initial
  // `phase: starting` + `phase: observing` events are not lost. start()
  // emits them synchronously; if we called start() first and then the
  // caller's onHuntCore, the web UI would miss the opening phase
  // events and the "no agents spawned yet" placeholder would never be
  // cleared.
  if (opts.onHuntCore) {
    try { opts.onHuntCore(huntCore); } catch { /* best effort */ }
  }
  huntCore.start();
  const wiring = wireHuntCore({
    core: huntCore,
    onFindingDeduped: (f) => {
      const sev = String(f.severity ?? 'info').toUpperCase();
      hlog('info', `\x1b[2m  ↳ deduped [${sev}] ${f.type} @ ${f.endpoint}\x1b[0m`);
    },
  });
  hlogWiring = wiring;
  const detachWiring = (): void => wiring.unsubscribe();

  // Build the orchestrator's worker factory wrapped to also report
  // findings to the model file. Block 14: forward primitive calls into
  // the HuntCore so the v4 event stream captures every probe.
  const orchestratorWorkerFactory = async (input: any) => {
    const r = await huntWorkerRunner({
      ...input,
      onPrimitive: (name, args, result) => {
        opts.onPrimitive?.(name, args, result);
        wiring.onPrimitive(name, args, result);
      },
    });
    return r;
  };

  // Shared finding callback — writes to app-model.json, prints to
  // the terminal so the user sees findings as they appear, and routes
  // through the HuntCore so dedup + v4 events fire from one place.
  const onOrchFinding = (finding: AppModelFinding) => {
    v3Findings.push(finding);
    updateAppModelSection(modelPath, 'findings', [finding], true);
    wiring.onFinding(finding);
    const sev = String(finding.severity ?? 'info').toUpperCase();
    hlog('info', `\x1b[1;33m  + [${sev}]\x1b[0m \x1b[36m${finding.type}\x1b[0m @ \x1b[4m${finding.endpoint}\x1b[0m (conf=${finding.confidence})`);
  };

  const orch = new AutonomousV3Orchestrator({
    graph,
    pool,
    appModel: model,
    strategy: defaultNodeStrategy,
    workerFactory: orchestratorWorkerFactory,
    // Block 21: forward LLM tokens to BOTH the caller's onLLMToken (e.g.
    // web UI WebSocket or CLI dim stream) AND the HuntCore wiring (so
    // the TUI / late-attach dashboards / dedup log also see them).
    onLLMToken: opts.onLLMToken
      ? (label, chunk) => {
          try { opts.onLLMToken?.(label, chunk); } catch { /* best effort */ }
          try { wiring.onLLMToken('composer', chunk); } catch { /* best effort */ }
        }
      : (label, chunk) => { try { wiring.onLLMToken('composer', chunk); } catch { /* best effort */ } },
    onComposerEvent: opts.onComposerEvent,
    onPrimitive: opts.onPrimitive,
    onFinding: onOrchFinding,
    onLog: (msg: string) => hlog('info', `  ${msg}`),
    onBeforeNode: async (): Promise<'proceed'> => 'proceed',
    maxRuntimeMs: opts.maxRuntimeMs,
    maxNodes: 50,
    enableConcurrency: true,
    maxConcurrency: 4,
    sleepBetweenNodesMs: 0,
    outDir: opts.outputDir,
  });

  // The interactive session's attack coordinator runs a single
  // Composer against a URL the user visits, then appends any findings
  // to app-model.json. It reuses the existing huntWorkerRunner.
  const attackCoordinator = async (url: string, technique?: string) => {
    if (url === '__list_findings__') {
      const m = readAppModel(modelPath);
      return { findings: 0, summary: m.findings.length === 0 ? 'no findings yet' : m.findings.map((f: any) => `  [${f.severity.toUpperCase()}] ${f.type} @ ${f.endpoint} (conf=${f.confidence})`).join('\n') };
    }
    const r = await huntWorkerRunner({
      hypothesis: {
        type: 'param',
        id: `interactive-${Date.now().toString(36)}`,
        endpoint: url,
        method: 'GET',
        param: '',
        technique: (technique ?? 'xss') as any,
        priority: 5,
        status: 'pending',
        source: 'interactive',
        createdAt: Date.now(),
      },
      workflowNodeId: `interactive-${Date.now().toString(36)}`,
      technique: (technique ?? 'xss') as any,
      url,
      method: 'GET',
      concreteUrl: url,
      activeSessionId: null,
      retryAttempt: 0,
      timeoutMs: 30_000,
      expectedSeverity: 'medium',
      onLLMToken: opts.onLLMToken
        ? (label: string, chunk: string) => {
            try { opts.onLLMToken?.(label, chunk); } catch { /* best effort */ }
            try { wiring.onLLMToken('composer', chunk); } catch { /* best effort */ }
          }
        : (label: string, chunk: string) => { try { wiring.onLLMToken('composer', chunk); } catch { /* best effort */ } },
      onLog: opts.onComposerEvent,
      onPrimitive: opts.onPrimitive,
    } as any);
    if (r.vulnerable) {
      const finding: AppModelFinding = {
        id: `f-${Date.now()}-${Math.floor(Math.random() * 10_000).toString(36)}`,
        type: r.technique,
        endpoint: r.url,
        param: '',
        method: 'GET',
        payload: r.payloads?.[0] ?? '',
        description: r.summary,
        evidence: r.evidence ?? [],
        confidence: r.confidence,
        confirmed: r.confidence >= 0.7,
        severity: r.confidence >= 0.85 ? 'high' : r.confidence >= 0.6 ? 'medium' : 'low',
      };
      updateAppModelSection(modelPath, 'findings', [finding], true);
      onOrchFinding(finding);
      return { findings: 1, summary: r.summary };
    }
    return { findings: 0, summary: r.summary };
  };

  // Launch the orchestrator in the background. It will process the
  // seed URLs from the spider without user interaction.
  const orchPromise = orch.run().catch((e) => {
    const { message } = captureError(e, 'orchestrator failed');
    hlog('error', `  ! orchestrator failed: ${message}`);
  });

  // Launch the interactive session in parallel. The user drives the
  // browser and types commands; the LLM attacks each URL they visit.
  // Block 17: `--skip interactive` (or `--no-interactive`) lets the
  // web UI / CI / non-TTY callers run the orchestrator only.
  const sessionPromise = (async () => {
    if (opts.skip.has('interactive')) {
      hlog('info', `  · Running in autonomous mode (orchestrator only; no browser REPL).`);
      return;
    }
    if (!process.stdin.isTTY) {
      // Non-interactive (CI, piped input) — skip the browser session.
      // The orchestrator handles the attacks on its own.
      hlog('info', `  · Non-TTY stdin — running in autonomous mode (no browser REPL).`);
      hlog('info', `  · To use the browser session, run in a terminal: hunt -t <url>`);
      return;
    }
    const session = new InteractiveHuntSession({
      target: opts.target,
      outputDir: opts.outputDir,
      modelPath,
      attackCoordinator,
      onFinding: (f) => hlog('info', `  + [${f.severity.toUpperCase()}] ${f.type} @ ${f.endpoint}`),
      initialEndpoints: model.endpoints as AppModelEndpoint[],
      // Wire the chat coordinator: free-form text typed by the user
      // becomes a chat message to the LLM with full hunt context.
      // The LLM replies with text + an optional multi-step plan that
      // the session executes (navigate, attack, fill form, etc.).
      // Form auto-test is on by default — the session scans the
      // current page every 1.5s and dispatches a chat turn for any
      // new form it finds.
      chatCoordinator: async (message, context) => {
        const { callChat } = await import('../cli/chat-coordinator');
        const { getDefaultLLMClient } = await import('../llm/client');
        const llm = getDefaultLLMClient();
        return await callChat(llm, message, context);
      },
    });
    try {
      await session.start();
    } catch (e) {
      hlog('error', `  ! interactive session failed: ${(e as Error).message}`);
    }
  })();

  // Wait for whichever finishes first. The orchestrator terminates
  // when the workflow graph is exhausted. The session terminates when
  // the user quits. In practice, the session is the one that finishes
  // first; the orchestrator may still be running against seeds.
  //
  // Block 19 fix: when `--skip interactive` (or `--no-interactive`) is
  // set — i.e. the web UI / CI / non-TTY callers — the sessionPromise
  // resolves immediately (no REPL/headed browser to open). If we still
  // raced, runHunt would tear down the pool + HuntCore while the
  // orchestrator's workers were still running, killing them mid-attack.
  // The previous bug was: orchestrator's `[orch] ←` end logs never
  // fired, 0 findings were reported even on known-vuln targets.
  //
  // Block 21.1 fix: the same trap fires for `!process.stdin.isTTY`.
  // The web UI / CI / piped callers all hit the non-TTY branch inside
  // sessionPromise (it returns early at line 385-391), and the
  // `Promise.race` would then resolve to the session promise, not the
  // orchestrator. So we treat `!isTTY` exactly like `--skip interactive`:
  // wait for the orchestrator to fully drain.
  //
  // Now: when interactive is skipped (or stdin is not a TTY), wait for
  // the orchestrator directly. When interactive is running in a real
  // terminal, race as before.
  if (opts.skip.has('interactive') || !process.stdin.isTTY) {
    await orchPromise;
  } else {
    await Promise.race([orchPromise, sessionPromise]);
  }

  // If the orchestrator is still running (the user quit while seeds
  // were still being processed), give it a few seconds to wind down.
  const orchStillRunning = !(await Promise.race([
    orchPromise.then(() => 'done' as const),
    new Promise<'alive'>((r) => setTimeout(() => r('alive'), 5000)),
  ]));
  if (orchStillRunning) {
    hlog('info', `  · Orchestrator still processing seeds; letting it finish in the background…`);
  }

  try {
    await pool.closeAll();
  } catch { /* best effort */ }

  // Block 14: stop the HuntCore. This flushes the live spec at
  // output/live.spec.ts, detaches the behavioral recorder, and emits
  // the v4 `done` event with a final summary. We tear the wiring down
  // first so the dedup log line doesn't fire on the way out.
  try {
    detachWiring();
    huntCore.stop(orchStillRunning ? 'time-budget' : 'user-quit');
  } catch { /* best effort */ }

  model = readAppModel(modelPath);
  const findingsAfter = model.findings.length - findingsBefore;
  hlog('info', `  ↳ ${findingsAfter} new findings (${model.findings.length} total)`);

  // 4. Chain engine (if not skipped)
  if (!opts.skip.has('chains') && model.findings.length > 0) {
    hlog('info', `[4/5] Running attack chain engine (heuristic)…`);
    const newChains: AttackChain[] = runHeuristicChains(model.findings, 'low');
    const existing = model.attackChains || [];
    model.attackChains = mergeChains(existing, newChains);
    await writeAppModelAsync(modelPath, model);
    const critical = model.attackChains.filter(c => c.severity === 'critical' || c.severity === 'high').length;
    hlog('info', `  ↳ ${newChains.length} new chains (${critical} critical/high, ${model.attackChains.length} total)`);
  } else {
    hlog('info', `[4/5] Chain engine skipped`);
  }

  // 5. Playwright test generation
  if (!opts.skip.has('tests') && model.findings.length > 0) {
    await generateAndWriteTests(model, opts, modelPath);
  } else if (model.findings.length === 0) {
    hlog('info', `[5/5] No findings — skipping test generation`);
  } else {
    hlog('info', `[5/5] Test generation skipped (--no-tests)`);
  }

  // 5b. Block 9b.2: post-hoc LLM synthesis backstop. If the LLM
  // didn't call recordTestStep enough during the hunt (or didn't have
  // the tool plumbed), ask the LLM now to write a Playwright spec
  // from the findings + behavioral trace. Gated on minLiveSteps so
  // we don't double-write when the live spec is already useful.
  if (!opts.skip.has('tests')) {
    try {
      const { synthesizeSpecFromTrace } = await import('../codegen/synthesize');
      const { getDefaultLLMClient } = await import('../llm/client');
      const synthResult = await synthesizeSpecFromTrace({
        outDir: opts.outputDir,
        findings: model.findings,
        behavioralSummary: readBehavioralSummary(opts.outputDir),
        target: opts.target,
        llm: getDefaultLLMClient(),
        minLiveSteps: 3,
      });
      if (synthResult.skippedReason) {
        hlog('info', `  · live-spec synthesis: ${synthResult.skippedReason}`);
      } else {
        hlog('info', `  · live-spec synthesis: wrote ${synthResult.outPath} (validated=${synthResult.validated})`);
      }
    } catch (e) {
      hlog('info', `  · live-spec synthesis failed: ${(e as Error).message}`);
    }
  }

  // 6. Report
  hlog('info', `[6/6] Compiling report…`);
  const sections = renderChainFirstReport(model);
  const htmlPath = path.join(opts.outputDir, 'report.html');
  fs.writeFileSync(htmlPath, renderChainReportHtml(sections), 'utf-8');
  const mdPath = path.join(opts.outputDir, 'report.md');
  fs.writeFileSync(mdPath, compileReport(model, 'markdown'), 'utf-8');
  hlog('info', `  ↳ report.html, report.md written to ${opts.outputDir}`);
  hlog('info', `\n\x1b[1;32m✓ Hunt complete in ${Math.round((Date.now() - startedAt) / 1000)}s\x1b[0m`);
  hlog('info', `  findings: ${model.findings.length}  chains: ${(model.attackChains || []).length}`);
  hlog('info', `  report:   ${htmlPath}\n`);
  // Detach the module-scope wiring so a second `runHunt` call doesn't
  // emit into a stale core.
  hlogWiring = null;
}

function buildAppModelFromCrawl(crawl: CrawlResult, target: string): AppModel {
  const model: AppModel = JSON.parse(JSON.stringify(DEFAULT_MODEL));
  model.target = target;
  model.visitedUrls = crawl.visitedUrls;
  // Copy the spider's auto-recording into recordedSessions['spider-auto']
  // so the user-flow Playwright generator can replay it.
  if (crawl.recording && crawl.recording.length > 0) {
    model.recordedSessions = {
      ...(model.recordedSessions || {}),
      'spider-auto': crawl.recording,
    };
  }
  // Map routes → endpoints
  for (const route of crawl.routes) {
    model.endpoints.push({
      path: route.url,
      method: 'GET',
      responseStatus: 200,
      contentType: route.contentType ?? 'text/html',
      requiresAuth: false,
      bodyPreview: route.bodyPreview ?? '',
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
  const origin = new URL(opts.target).origin;
  const seen = new Set<string>();
  const addedIds: string[] = [];

  const add = (url: string, isApi: boolean) => {
    if (seen.has(url)) return;
    seen.add(url);
    const node = graph.addNode({
      id: randomUUID(),
      url,
      title: url,
      type: isApi ? 'api' : 'page',
      authRequired: false,
      authVerified: false,
      discoveredFrom: null,
      discoveryMethod: 'navigation',
    });
    addedIds.push(node.id);
  };

  // Seed from explicit --seed-urls (if provided)
  for (const url of (opts.seedUrls || [])) {
    const fullUrl = url.startsWith('http') ? url : `${origin}${url}`;
    const isApi = fullUrl.includes('/api/') || fullUrl.includes('/graphql') || fullUrl.includes('/oauth') || fullUrl.includes('/.well-known') || /\/v\d+\//.test(fullUrl);
    add(fullUrl, isApi);
  }

  // Seed from the spider's discovered URLs
  for (const url of (model.visitedUrls || [])) {
    const isApi = url.includes('/api/') || /\/v\d+\//.test(url) || url.includes('/graphql') || url.includes('/oauth') || url.includes('/.well-known');
    add(url, isApi);
  }

  // Seed from the discovered endpoints
  for (const ep of (model.endpoints || [])) {
    const fullUrl = ep.path.startsWith('http') ? ep.path : `${origin}${ep.path}`;
    add(fullUrl, ep.method?.toUpperCase() !== 'GET' || ep.path.includes('/api/') || ep.path.includes('/graphql'));
  }

  // FALLBACK: if the graph is empty, seed with the target root
  if (seen.size === 0) {
    hlog('info', `  ↳ workflow graph empty — seeding with target root`);
    add(opts.target, false);
  }

  // Mark all seeded nodes as reachable so the orchestrator processes them
  for (const id of addedIds) graph.markReachable(id);
  hlog('info', `  ↳ workflow graph: ${addedIds.length} reachable nodes`);

  const pool = getDefaultSessionPool();
  try { pool.switchTo('default'); } catch { /* ignore */ }
  return { graph, pool };
}


// Block 21: stack-trace-capturing error reporter. `e.message` is often
// too short ("connect ECONNREFUSED", "ENOTFOUND", "LLM call failed")
// to debug. The stack shows WHERE the failure happened. We log the
// full stack to stderr and a one-line summary to the user via hlog.
// Use this anywhere a `(e as Error).message` would have been logged
// without context.
function captureError(e: unknown, where: string): { message: string; stack?: string } {
  const err = e instanceof Error ? e : new Error(String(e));
  const stack = err.stack ?? '';
  // Strip noisy node_modules frames to keep the trace readable.
  const lines = stack.split('\n').filter(
    (l) => l.trim() && !/node_modules\/.+\.js/.test(l) && !/internal\/.+\.js/.test(l)
  );
  const trimmed = lines.slice(0, 8).join('\n');
  if (process.stderr.isTTY) {
    process.stderr.write(`\n\x1b[31m✗ ${where}\x1b[0m\n${trimmed}\n\n`);
  }
  return { message: err.message, stack: trimmed };
}

// ── Composer-based worker ──
//
// The hand-rolled 10-probe switch is replaced by a single Composer.run() call.
// The Composer:
//   1. Asks the LLM to propose 1-3 attack plans for the target endpoint
//   2. For each plan, picks primitives from the catalog and executes them
//   3. Triage is heuristic-fast (compareResponses, measureTiming, etc.) plus
//      an LLM call for ambiguous cases
//   4. Specialists (waf-bypass, second-order, chain-reasoning) are spawned
//      recursively when the main composer detects a need
async function huntWorkerRunner(input: WorkerSpawnInput): Promise<WorkerSpawnResult> {
  const start = Date.now();
  dlog(`composer run technique=${input.technique} url=${input.url} method=${input.method}`);

  const { Composer } = await import('../agents/composer');
  const { getDefaultLLMClient } = await import('../llm/client');
  const llm = getDefaultLLMClient();

  const target: AppModelEndpoint = {
    path: input.concreteUrl ?? input.url,
    method: (input.method || 'GET').toUpperCase(),
    params: input.allParams && input.allParams.length > 0
      ? input.allParams
      : input.param
        ? [{ name: input.param, type: 'string', required: true }]
        : [],
    requiresAuth: false,
    responseStatus: 0,
    contentType: 'application/octet-stream',
    bodyPreview: input.bodyPreview ?? '',
  };

  const ctx: PrimitiveContext = {
    baseUrl: input.url,
    cookies: {},
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: Date.now(), maxMs: Math.max(5_000, input.timeoutMs ?? 30_000) },
  };
  // Attach a live Playwright-spec writer when the worker has an output dir.
  // recordTestStep uses this to persist LLM-chosen test steps to disk.
  // Use a per-node filename so parallel v3 workers don't corrupt the
  // same file. Post-hoc synthesis in codegen/synthesize.ts merges them.
  if (input.outDir) {
    const nodeTag = (input.workflowNodeId ?? `node-${Date.now()}`).replace(/[^a-z0-9_-]/gi, '_');
    ctx.liveSpec = new LiveTestWriter({
      outPath: path.join(input.outDir, `live-${nodeTag}.spec.ts`),
      baseUrl: input.url,
      // Test name must be short and human-readable. Using the raw URL
      // produces names like "Hunt https://xss-game.appspot.com/level1/frame?query=Enter+query+here..."
      // which Playwright truncates with "..." in reports and confuses users.
      // Derive a clean label from host + path, capped at 60 chars.
      testName: `Hunt ${deriveShortUrlLabel(input.url)}`,
      description: `Auto-generated by Ultimatrix (worker ${nodeTag}) on ${new Date().toISOString()}`,
    });
  }

  const composer = new Composer({
    llm,
    maxDepth: 2,
    planTimeoutMs: input.timeoutMs ?? 30_000,
    // Block 21: wrap the LLM token sink so tokens also flow into the
    // v4 HuntCore (for the web UI / TUI / diff) while the caller's
    // original onLLMToken still runs (e.g. for terminal streaming).
    // The wiring is injected by the orchestrator via WorkerSpawnInput's
    // `onLLMToken` if present; otherwise we use the caller's sink.
    onLLMToken: input.onLLMToken,
    onLog: input.onLog,
    onPrimitive: input.onPrimitive,
  });

  try {
    const result = await composer.run(target, ctx);
    if (result.findings.length > 0) {
      const f = result.findings[0];
      return {
        vulnerable: true,
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.7,
        evidence: f.evidence.map((e) => ({
          type: (e.type === 'screenshot' ? 'screenshot' : e.type === 'har_entry' ? 'har_entry' : 'text') as 'text' | 'screenshot' | 'har_entry' | 'raw_request' | 'raw_response',
          data: e.data,
          label: e.label,
          timestamp: e.timestamp,
        })),
        payloads: f.payload ? [f.payload] : [],
        summary: f.description ?? `${f.type} @ ${f.endpoint}`,
        technique: (input.technique as string) as any,
        url: f.endpoint,
        durationMs: Date.now() - start,
      };
    }
  } catch (e) {
    dlog(`composer error: ${(e as Error).message}`);
  }

  return {
    vulnerable: false,
    confidence: 0,
    evidence: [],
    payloads: [],
    summary: `${input.technique} @ ${input.url}: no vulnerability found`,
    technique: (input.technique as string) as any,
    url: input.url,
    durationMs: Date.now() - start,
  };
}

// `verbose` flag to debug: set to true to log every probe attempt to stderr
const HUNT_DEBUG = process.env.HUNT_DEBUG === '1';
function dlog(...args: any[]): void {
  if (HUNT_DEBUG) console.error('[worker]', ...args);
}

function mergeChains(existing: AttackChain[], fresh: AttackChain[]): AttackChain[] {
  const seen = new Set(existing.map(c => c.id));
  return [...existing, ...fresh.filter(c => !seen.has(c.id))];
}

async function generateAndWriteTests(model: AppModel, opts: HuntOptions, _modelPath: string): Promise<void> {
  const testsDir = path.join(opts.outputDir, 'playwright-tests');
  const result = generateFindingTests(model, {
    outDir: testsDir,
    includeChainTests: true,
  });
  const written = writeFindingTests(result, testsDir);
  hlog('info', `  ↳ wrote ${written.length} files to ${testsDir} (${result.findingsWritten} finding tests, ${result.chainsWritten} chain tests)`);
}

/**
 * Read the behavioral.jsonl trace and produce a one-line-per-step
 * summary for the synthesis prompt. Capped at 30 steps × 200 chars.
 */
function readBehavioralSummary(outDir: string): string {
  const p = path.join(outDir, 'behavioral.jsonl');
  if (!fs.existsSync(p)) return '';
  try {
    const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
    const summary = lines.slice(0, 30).map((l) => {
      try {
        const obj = JSON.parse(l);
        if (obj && obj.type && obj.data) {
          return `${obj.type}: ${JSON.stringify(obj.data).slice(0, 200)}`;
        }
        return l.slice(0, 200);
      } catch {
        return l.slice(0, 200);
      }
    });
    return summary.join('\n');
  } catch {
    return '';
  }
}

async function handleSlash(
  cmd: string,
  args: string[],
  opts: HuntOptions,
  modelPath: string,
  prompt: HuntPrompt | null,
): Promise<string> {
  switch (cmd) {
    case 'auto':
    case 'guided':
    case 'interactive':
      return 'no modes in this build — the LLM runs the attack. Use /quit to exit.';
    case 'plan': {
      const m = readAppModel(modelPath);
      const ep = pickNextEndpoint(m, opts.target);
      if (!ep) return 'No endpoint available to plan against.';
      const { Composer } = await import('../agents/composer');
      const { getDefaultLLMClient } = await import('../llm/client');
      const composer = new Composer({ llm: getDefaultLLMClient(), maxDepth: 2, planTimeoutMs: 15_000, onLLMToken: opts.onLLMToken });
      const ctx: PrimitiveContext = {
        baseUrl: ep.path,
        cookies: {},
        evidenceLog: [],
        depth: 0,
        budget: { startedAt: Date.now(), maxMs: 15_000 },
      };
      try {
        const plans = await composer.proposePlans(ep, ctx, 3);
        if (plans.length === 0) return 'No plans proposed (LLM returned no candidates).';
        return plans.map((p, i) =>
          `  [${i + 1}] ${p.technique} on ${ep.method} ${ep.path}\n` +
          `      reason: ${p.rationale}\n` +
          `      primitives: ${p.primitives.map(s => s.name).join(' → ')}`,
        ).join('\n\n');
      } catch (e) {
        return `Plan error: ${(e as Error).message}`;
      }
    }
    case 'attack': {
      const n = parseInt(args[0] ?? '', 10);
      if (!n || n < 1 || n > 9) return 'Usage: /attack <1-9> (run after /plan)';
      const m = readAppModel(modelPath);
      const ep = pickNextEndpoint(m, opts.target);
      if (!ep) return 'No endpoint available.';
      const { Composer } = await import('../agents/composer');
      const { getDefaultLLMClient } = await import('../llm/client');
      const composer = new Composer({ llm: getDefaultLLMClient(), maxDepth: 2, planTimeoutMs: 30_000, onLLMToken: opts.onLLMToken });
      const ctx: PrimitiveContext = {
        baseUrl: ep.path,
        cookies: {},
        evidenceLog: [],
        depth: 0,
        budget: { startedAt: Date.now(), maxMs: 30_000 },
      };
      const plans = await composer.proposePlans(ep, ctx, n);
      const target = plans[n - 1];
      if (!target) return `Plan #${n} not available.`;
      const findings = await composer.executePlan(target, ep, ctx);
      const lines: string[] = [];
      lines.push(`Executed plan #${n}: ${target.technique}`);
      for (const fr of findings) {
        updateAppModelSection(modelPath, 'findings', [fr], true);
        lines.push(`  + [${fr.severity.toUpperCase()}] ${fr.type} @ ${fr.endpoint} (conf=${fr.confidence})`);
      }
      if (findings.length === 0) lines.push('  (no findings)');
      return lines.join('\n');
    }
    case 'agents': {
      return [
        '  Composer (depth 0)',
        '  ├─ WAF bypass specialist (depth 1)  — only when 403/406 detected',
        '  ├─ Second-order specialist (depth 1) — only when storage + reflection pattern',
        '  └─ Chain reasoning specialist (depth 1) — only on /chain or end of run',
        '',
        'Current specialists are spawned dynamically by the Composer based on primitive results.',
        'The composer is depth-capped at 2 to prevent recursion.',
      ].join('\n');
    }
    case 'chain': {
      const m = readAppModel(modelPath);
      if (m.findings.length === 0) return 'No findings to chain.';
      try {
        const { runChainReasoning } = await import('../agents/specialists-composers');
        const { getDefaultLLMClient } = await import('../llm/client');
        const result = await runChainReasoning({ llm: getDefaultLLMClient(), findings: m.findings, target: opts.target });
        if (result.chains.length === 0) return 'No chains identified.';
        m.attackChains = mergeChains(m.attackChains || [], result.chains);
        await writeAppModelAsync(modelPath, m);
        return result.chains.map((c, i) =>
          `  [${i + 1}] ${c.name} (${c.severity})\n` +
          `      ${c.steps.length} steps, confidence=${c.confidence}`,
        ).join('\n\n');
      } catch (e) {
        return `Chain error: ${(e as Error).message}`;
      }
    }
    case 'budget': {
      const t = args[0];
      if (!t) return 'Usage: /budget <time>  (e.g. "15m", "60s", "2h")';
      const ms = parseDuration(t);
      if (!ms) return `Could not parse "${t}". Use "30s", "5m", "2h".`;
      opts.maxRuntimeMs = ms;
      return `Time budget → ${t} (${ms}ms)`;
    }
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
      prompt?.close();
      process.exit(0);
      return ''; // unreachable
    default:
      return `Unknown command: /${cmd}. Try /help.`;
  }
}

function pickNextEndpoint(model: AppModel, target: string): AppModelEndpoint | null {
  if (model.endpoints && model.endpoints.length > 0) return model.endpoints[0];
  return { path: target, method: 'GET', params: [], requiresAuth: false, responseStatus: 0, contentType: 'text/html', bodyPreview: '' };
}

function parseDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*([smh])$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (u === 's') return Math.round(n * 1000);
  if (u === 'm') return Math.round(n * 60_000);
  if (u === 'h') return Math.round(n * 3_600_000);
  return null;
}
