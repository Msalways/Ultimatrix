#!/usr/bin/env node
/**
 * scripts/interact-v3-xss-game.js
 *
 * Interactive v3 orchestrator: pauses before each node, lets the user
 * proceed/skip/inspect/abort. Run like: `node scripts/interact-v3-xss-game.js`
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const {
  AutonomousV3Orchestrator,
  WorkflowStateGraph,
  SessionPool,
  DEFAULT_MODEL,
  readAppModel,
  writeAppModel,
  updateAppModelSection,
  compileReport,
  SpiderCrawler,
  getSharedBrowserManager,
} = require('../dist/index.js');

const OUT_DIR = path.resolve('./output-v3-interactive');
fs.mkdirSync(OUT_DIR, { recursive: true });
const appModelPath = path.join(OUT_DIR, 'app-model.json');

const KNOWN_LEVELS = [
  'https://xss-game.appspot.com/',
  'https://xss-game.appspot.com/level1',
  'https://xss-game.appspot.com/level1/frame',
  'https://xss-game.appspot.com/level2',
  'https://xss-game.appspot.com/level2/frame',
  'https://xss-game.appspot.com/level3/frame',
  'https://xss-game.appspot.com/level4/frame',
  'https://xss-game.appspot.com/level5/frame',
  'https://xss-game.appspot.com/level6/frame',
];

const REFLECTED_PAYLOAD = '<img src=x onerror=alert("ultimatrix-interactive-")>';

function makeRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function inspectState(graph, pool, appModelPath) {
  const size = graph.size();
  const cur = readAppModel(appModelPath);
  console.log(`\n  -- graph: ${size.nodes} nodes, ${size.edges} edges`);
  console.log(`  -- pool:  ${pool.list().map((s) => `${s.id}(${s.role})`).join(', ')}`);
  console.log(`  -- model: ${cur.findings.length} findings, ${(cur.visitedUrls || []).length} visitedUrls, ${(cur.endpoints || []).length} endpoints`);
  console.log(`  -- recent findings:`);
  for (const f of cur.findings.slice(-3)) {
    console.log(`     · ${f.type} severity=${f.severity} endpoint=${f.endpoint}`);
  }
  console.log('');
}

(async () => {
  console.log('[v3-interactive] === starting ===\n');

  console.log('[v3-interactive] Step 1: quick spider crawl...');
  writeAppModel(appModelPath, { ...DEFAULT_MODEL, target: 'https://xss-game.appspot.com/' });
  let spiderRoutes = [];
  try {
    const mgr = getSharedBrowserManager(true);
    const spider = new SpiderCrawler(mgr, 'spider-session');
    const r = await spider.crawl('https://xss-game.appspot.com/', 2, undefined, OUT_DIR);
    spiderRoutes = r.routes || [];
    console.log(`[spider] found ${spiderRoutes.length} routes`);
  } catch (e) {
    console.log(`[spider] failed: ${e.message} — using seed list only`);
  }
  await new Promise((r) => setTimeout(r, 200));

  console.log('\n[v3-interactive] Step 2: building v3 graph from spider + seeds...');
  const graph = new WorkflowStateGraph();
  const added = new Set();
  for (const route of spiderRoutes) {
    if (!route.url.includes('xss-game.appspot.com')) continue;
    const id = 'spider-' + Buffer.from(route.url).toString('base64url').slice(0, 12);
    if (added.has(id)) continue;
    added.add(id);
    graph.addNode({ id, url: route.url, title: route.title || route.url, type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'spider' });
    graph.markReachable(id);
  }
  for (const url of KNOWN_LEVELS) {
    const id = 'seed-' + Buffer.from(url).toString('base64url').slice(0, 12);
    if (added.has(id)) continue;
    added.add(id);
    graph.addNode({ id, url, title: url, type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'seed' });
    graph.markReachable(id);
  }
  graph.refreshReachable();
  console.log(`[graph] ${added.size} reachable nodes`);

  const pool = new SessionPool({ headless: true, networkCaptureEnabled: false });
  const rl = makeRl();
  let aborted = false;

  const workerFactory = async (input) => {
    const t0 = Date.now();
    let vulnerable = false;
    let evidence = '';
    let error;
    try {
      const url = input.url;
      const candidates = url.includes('?')
        ? [url.replace(/=([^&]*)$/, `=${encodeURIComponent(REFLECTED_PAYLOAD)}`)]
        : [`${url}?query=${encodeURIComponent(REFLECTED_PAYLOAD)}`, `${url}?q=${encodeURIComponent(REFLECTED_PAYLOAD)}`, `${url}?input1=${encodeURIComponent(REFLECTED_PAYLOAD)}`];
      for (const testUrl of candidates) {
        const resp = await fetch(testUrl, { signal: AbortSignal.timeout(8000) });
        const body = await resp.text();
        if (body.includes(REFLECTED_PAYLOAD) && !body.includes('&lt;img')) {
          vulnerable = true;
          const idx = body.indexOf(REFLECTED_PAYLOAD);
          evidence = `URL: ${testUrl}\nStatus: ${resp.status}\nContext: ...${body.slice(Math.max(0, idx - 60), Math.min(body.length, idx + 200))}...`;
          break;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return {
      vulnerable,
      confidence: vulnerable ? 0.9 : 0,
      evidence: vulnerable ? [{ type: 'text', data: evidence, label: 'XSS reflection', timestamp: Date.now() }] : [],
      payloads: vulnerable ? [REFLECTED_PAYLOAD] : [],
      summary: vulnerable ? `XSS at ${input.url}` : `clean at ${input.url}`,
      technique: input.technique,
      url: input.url,
      error,
      durationMs: Date.now() - t0,
    };
  };

  const orch = new AutonomousV3Orchestrator({
    graph, pool, workerFactory,
    maxRuntimeMs: 600_000,
    maxNodes: 100,
    perTechniqueBudget: 1,
    enableConcurrency: false,
    maxConcurrency: 1,
    onFinding: (f) => {
      console.log(`\n  ✓ FINDING: ${f.type} severity=${f.severity} endpoint=${f.endpoint}\n`);
      try {
        const r = updateAppModelSection(appModelPath, 'findings', [f], true);
        if (r && typeof r.then === 'function') r.catch(() => {});
      } catch {}
    },
    onNodeUpdate: (n, status) => {
      if (status === 'completed' || status === 'failed') {
        process.stdout.write(`  · ${n.id} → ${status}\n`);
      }
    },
    onBeforeNode: async (node, spec) => {
      console.log(`\n  → next node: ${node.id}`);
      console.log(`     url:     ${node.url}`);
      console.log(`     title:   ${node.title || '(no title)'}`);
      if (spec) {
        console.log(`     tech:    ${spec.technique}`);
        console.log(`     method:  ${spec.method}`);
        console.log(`     param:   ${spec.param || '(none)'}`);
        console.log(`     timeout: ${spec.timeoutMs}ms`);
        console.log(`     severity: ${spec.expectedSeverity}`);
      } else {
        console.log(`     spec:    (could not resolve strategy)`);
      }
      let decision = 'proceed';
      while (true) {
        const ans = await ask(rl, '     [Y]es / [s]kip / [i]nspect / [d]etail / [a]bort? ');
        const c = ans.toLowerCase() || 'y';
        if (c === 'y' || c === '') { decision = 'proceed'; break; }
        if (c === 's') { decision = 'skip'; break; }
        if (c === 'a') { decision = 'abort'; break; }
        if (c === 'i') { await inspectState(graph, pool, appModelPath); continue; }
        if (c === 'd') {
          console.log(`     raw node: ${JSON.stringify(node, null, 2).slice(0, 500)}`);
          continue;
        }
        console.log(`     unknown: ${ans}`);
      }
      return decision;
    },
    onLog: () => {},
  });

  console.log('\n[v3-interactive] Step 3: orchestrator running with interactive prompts.');
  console.log('             Press [Y] to run a node, [s] to skip, [i] to inspect, [d] for detail, [a] to abort.\n');
  let result;
  try {
    result = await orch.run();
  } catch (e) {
    console.log(`[orch] error: ${e.message}`);
  }
  await pool.closeAll();
  rl.close();

  await new Promise((r) => setTimeout(r, 300));
  if (result) {
    const finalModel = readAppModel(appModelPath);
    const reportModel = {
      ...finalModel,
      findings: (result.findings.length > 0 ? result.findings : (finalModel.findings || [])),
      visitedUrls: Array.from(added).map((id) => graph.getInternal ? (graph.getInternal(id)?.url || '') : '').filter(Boolean),
    };
    const reportHtml = compileReport(reportModel, 'html');
    const reportPath = path.join(OUT_DIR, 'final-security-report.html');
    fs.writeFileSync(reportPath, reportHtml);
    console.log(`\n[v3-interactive] === DONE ===`);
    console.log(`  completed: ${result.completedNodes}  failed: ${result.failedNodes}  findings: ${result.findings.length}`);
    console.log(`  terminated by: ${result.terminatedBy}`);
    console.log(`  report: ${reportPath} (${reportHtml.length} bytes)`);
  }
  process.exit(0);
})();
