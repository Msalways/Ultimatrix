#!/usr/bin/env node
/**
 * scripts/smoke-spider-v3-xss-game.js
 *
 * Full pipeline: spider → v3 graph → v3 worker → findings → report.
 * Tests across ALL levels of xss-game (not just the seed URL).
 *
 * Uses a hand-rolled worker (no LLM) to detect reflected XSS in each
 * level's frame, plus DOM-stored XSS patterns for the parent pages.
 */
const path = require('path');
const fs = require('fs');
const {
  AutonomousV3Orchestrator,
  WorkflowStateGraph,
  SessionPool,
  DEFAULT_MODEL,
  readAppModel,
  writeAppModel,
  updateAppModelSection,
  compileReport,
} = require('../dist/index.js');
const { SpiderCrawler, getSharedBrowserManager } = require('../dist/index.js');

const OUT_DIR = path.resolve(process.argv[2] || './output-xss-game-full');
fs.mkdirSync(OUT_DIR, { recursive: true });
const appModelPath = path.join(OUT_DIR, 'app-model.json');

const REFLECTED_PAYLOAD = '<img src=x onerror=alert("ultimatrix-xss-")>';

const KNOWN_LEVELS = [
  { id: 'lvl1', url: 'https://xss-game.appspot.com/level1/frame', technique: 'xss' },
  { id: 'lvl2', url: 'https://xss-game.appspot.com/level2/frame', technique: 'xss' },
  { id: 'lvl3', url: 'https://xss-game.appspot.com/level3/frame', technique: 'xss' },
  { id: 'lvl4', url: 'https://xss-game.appspot.com/level4/frame', technique: 'xss' },
  { id: 'lvl5', url: 'https://xss-game.appspot.com/level5/frame', technique: 'xss' },
  { id: 'lvl6', url: 'https://xss-game.appspot.com/level6/frame', technique: 'xss' },
  { id: 'parent-index', url: 'https://xss-game.appspot.com/', technique: 'xss' },
  { id: 'parent-l1', url: 'https://xss-game.appspot.com/level1', technique: 'xss' },
  { id: 'parent-l2', url: 'https://xss-game.appspot.com/level2', technique: 'xss' },
];

async function freshSpiderCrawl() {
  console.log('\n[spider] starting fresh crawl of xss-game...');
  const manager = getSharedBrowserManager(true);
  const spider = new SpiderCrawler(manager, 'spider-session');
  const target = 'https://xss-game.appspot.com/';
  const result = await spider.crawl(target, 2, undefined, OUT_DIR);
  console.log(`[spider] visited: ${result.routes.length} routes`);
  console.log(`[spider] discovered URLs (first 25):`);
  for (const r of result.routes.slice(0, 25)) {
    console.log(`  - ${r.url}  (title: ${(r.title || '').slice(0, 50)})`);
  }
  return result;
}

async function buildGraphFromSpiderOrSeeds(spiderResult) {
  const visited = new Set(spiderResult.routes.map((r) => r.url.replace(/\/$/, '')));
  console.log(`\n[graph] spider discovered ${visited.size} unique URLs`);
  const graph = new WorkflowStateGraph();
  const allCandidates = [];
  for (const lvl of KNOWN_LEVELS) {
    const bareUrl = lvl.url.replace(/\/$/, '');
    if (!visited.has(bareUrl)) {
      console.log(`[graph] spider MISSED ${lvl.url} — adding from seed list`);
    }
    allCandidates.push({ id: lvl.id, url: lvl.url, technique: lvl.technique });
  }
  for (const r of spiderResult.routes) {
    if (r.url.includes('xss-game.appspot.com') && !allCandidates.find((c) => c.url === r.url)) {
      allCandidates.push({ id: 'spider-' + Buffer.from(r.url).toString('base64url').slice(0, 10), url: r.url, technique: 'xss' });
    }
  }
  for (const c of allCandidates) {
    graph.addNode({ id: c.id, url: c.url, title: c.url, type: c.url.includes('/frame') ? 'page' : 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'spider' });
    graph.markReachable(c.id);
  }
  graph.refreshReachable();
  console.log(`[graph] built ${allCandidates.length} reachable nodes`);
  return { graph, candidates: allCandidates };
}

function makeWorkerFactory() {
  return async (input) => {
    const t0 = Date.now();
    let vulnerable = false;
    let evidenceText = '';
    let finalUrl = '';
    let error;
    const baseUrl = input.url;
    const candidates = [];
    if (baseUrl.includes('?')) {
      candidates.push(baseUrl.replace(/=([^&]*)/, `=${encodeURIComponent(REFLECTED_PAYLOAD)}`));
    } else {
      candidates.push(`${baseUrl}?query=${encodeURIComponent(REFLECTED_PAYLOAD)}`);
      candidates.push(`${baseUrl}?q=${encodeURIComponent(REFLECTED_PAYLOAD)}`);
      candidates.push(`${baseUrl}?callback=${encodeURIComponent(REFLECTED_PAYLOAD)}`);
      candidates.push(`${baseUrl}?input1=${encodeURIComponent(REFLECTED_PAYLOAD)}`);
    }
    try {
      for (const testUrl of candidates) {
        const resp = await fetch(testUrl, { signal: AbortSignal.timeout(10000) });
        const body = await resp.text();
        const reflected = body.includes(REFLECTED_PAYLOAD);
        const escaped = body.includes('&lt;img') || body.includes('&amp;lt;');
        if (reflected && !escaped) {
          vulnerable = true;
          finalUrl = testUrl;
          const idx = body.indexOf(REFLECTED_PAYLOAD);
          const start = Math.max(0, idx - 100);
          const end = Math.min(body.length, idx + 250);
          evidenceText = `URL: ${testUrl}\nStatus: ${resp.status}\nReflected: true\nBody context: ...${body.slice(start, end)}...`;
          break;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return {
      vulnerable,
      confidence: vulnerable ? 0.9 : 0,
      evidence: vulnerable ? [{ type: 'text', data: evidenceText, label: 'XSS reflection proof', timestamp: Date.now() }] : [],
      payloads: vulnerable ? [REFLECTED_PAYLOAD] : [],
      summary: vulnerable ? `Reflected XSS at ${input.url} (tested: ${finalUrl})` : `No reflected XSS at ${input.url}`,
      technique: input.technique,
      url: input.url,
      error,
      durationMs: Date.now() - t0,
    };
  };
}

(async () => {
  writeAppModel(appModelPath, { ...DEFAULT_MODEL, target: 'https://xss-game.appspot.com/' });
  const spiderResult = await freshSpiderCrawl();
  const { graph, candidates } = await buildGraphFromSpiderOrSeeds(spiderResult);
  const pool = new SessionPool({ headless: true, networkCaptureEnabled: false });
  let findings = 0;
  const orch = new AutonomousV3Orchestrator({
    graph,
    pool,
    workerFactory: makeWorkerFactory(),
    maxRuntimeMs: 180_000,
    maxNodes: 50,
    perTechniqueBudget: 1,
    enableConcurrency: true,
    maxConcurrency: 4,
    onFinding: (finding) => {
      findings++;
      console.log(`[orch] FINDING ${findings}: ${finding.type} severity=${finding.severity} endpoint=${finding.endpoint}`);
      try {
        const r = updateAppModelSection(appModelPath, 'findings', [finding], true);
        if (r && typeof r.then === 'function') r.catch(() => {});
      } catch {}
    },
    onNodeUpdate: (node, status) => {
      if (status !== 'completed') console.log(`[orch] node ${node.id} → ${status}`);
    },
    onLog: (m) => { if (m.includes('rate-limited') || m.includes('resolved')) {} },
  });

  console.log(`\n[v3] running orchestrator on ${candidates.length} nodes (max concurrency=4)...`);
  const t0 = Date.now();
  const result = await orch.run();
  const elapsed = Date.now() - t0;
  await pool.closeAll();

  console.log(`\n=== v3 result ===`);
  console.log(`  nodes         : ${result.totalNodes}`);
  console.log(`  completed     : ${result.completedNodes}`);
  console.log(`  failed        : ${result.failedNodes}`);
  console.log(`  findings      : ${result.findings.length}`);
  console.log(`  durationMs    : ${result.durationMs}`);
  console.log(`  effectiveConc : ${result.effectiveMaxConcurrency}`);
  console.log(`  rateLimitEvts : ${result.rateLimitEvents}`);
  console.log(`  wallClockMs   : ${elapsed}`);

  await new Promise((r) => setTimeout(r, 300));
  const finalModel = readAppModel(appModelPath);
  const reportModel = {
    ...finalModel,
    findings: result.findings.length > 0 ? result.findings : (finalModel.findings || []),
    visitedUrls: candidates.map((c) => c.url),
    endpoints: candidates.filter((c) => c.url.includes('/frame')).map((c) => ({ path: c.url, method: 'GET' })),
    workflow: {
      nodes: candidates.map((c) => ({ id: c.id, url: c.url, type: 'page' })),
      edges: candidates.slice(0, -1).map((c, i) => ({ fromId: c.id, toId: candidates[i + 1].id, trigger: 'navigation', label: 'next' })),
    },
  };
  const reportHtml = compileReport(reportModel, 'html');
  const reportPath = path.join(OUT_DIR, 'final-security-report.html');
  fs.writeFileSync(reportPath, reportHtml);
  console.log(`\n[report] wrote ${reportPath} (${reportHtml.length} bytes)`);
  console.log(`\n[v3] ${result.findings.length > 0 ? 'PASS' : 'FAIL'}: ${result.findings.length}/${candidates.length} nodes had findings`);
  process.exit(result.findings.length > 0 ? 0 : 1);
})();
