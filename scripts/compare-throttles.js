#!/usr/bin/env node
/**
 * scripts/compare-throttles.js
 *
 * Runs the v3 orchestrator against xss-game L1 in two modes:
 *  1. THROTTLED:  maxConcurrency=1, sleepBetweenNodesMs=1000
 *  2. MAX:        maxConcurrency=4, sleepBetweenNodesMs=0
 *
 * Each mode processes N copies of the same node (to exercise concurrency).
 * Reports effective concurrency, duration, and findings.
 */
const path = require('path');
const fs = require('fs');
const {
  AutonomousV3Orchestrator,
  WorkflowStateGraph,
  SessionPool,
  DEFAULT_MODEL,
  writeAppModel,
} = require('../dist/index.js');

const REFLECTED_PAYLOAD = '<script>alert("ultimatrix-throttle-compare")</script>';
const N_NODES = 5;
const OUT_BASE = path.resolve('./output-throttle-compare');
fs.mkdirSync(OUT_BASE, { recursive: true });

function makeGraph(numNodes) {
  const graph = new WorkflowStateGraph();
  for (let i = 0; i < numNodes; i++) {
    graph.addNode({ id: `n${i}`, url: `https://xss-game.appspot.com/level1/frame?query=test${i}`, title: `L1 node ${i}`, type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    graph.markReachable(`n${i}`);
  }
  graph.refreshReachable();
  return graph;
}

function makeWorkerFactory(sharedStats) {
  return async (input) => {
    sharedStats.invocations++;
    const t0 = Date.now();
    sharedStats.inflight++;
    sharedStats.peakInflight = Math.max(sharedStats.peakInflight, sharedStats.inflight);
    try {
      const testUrl = input.url.replace(/=[^&]*$/, `=${encodeURIComponent(REFLECTED_PAYLOAD)}`);
      const resp = await fetch(testUrl, { signal: AbortSignal.timeout(15000) });
      const body = await resp.text();
      const reflected = body.includes(REFLECTED_PAYLOAD) || body.includes('<script>alert("ultimatrix-throttle-compare")</script>');
      const escaped = body.includes('&lt;script&gt;');
      const vulnerable = reflected && !escaped;
      sharedStats.vulnsFound += vulnerable ? 1 : 0;
      return {
        vulnerable, confidence: vulnerable ? 0.9 : 0, evidence: vulnerable ? [{ type: 'text', data: `Reflected at ${testUrl}`, label: 'XSS', timestamp: Date.now() }] : [],
        payloads: vulnerable ? [REFLECTED_PAYLOAD] : [], summary: vulnerable ? 'XSS' : 'no-xss',
        technique: input.technique, url: input.url, durationMs: Date.now() - t0,
      };
    } finally {
      sharedStats.inflight--;
    }
  };
}

async function runMode(label, opts) {
  console.log(`\n[${label}] maxConcurrency=${opts.maxConcurrency} sleepBetweenNodesMs=${opts.sleepBetweenNodesMs} nodes=${N_NODES}`);
  const stats = { invocations: 0, inflight: 0, peakInflight: 0, vulnsFound: 0 };
  const graph = makeGraph(N_NODES);
  const pool = new SessionPool({ headless: true, networkCaptureEnabled: false });
  const appModelPath = path.join(OUT_BASE, `${label}.app-model.json`);
  writeAppModel(appModelPath, { ...DEFAULT_MODEL, target: 'https://xss-game.appspot.com/level1/frame' });
  const orch = new AutonomousV3Orchestrator({
    graph, pool,
    workerFactory: makeWorkerFactory(stats),
    maxRuntimeMs: 60_000,
    maxNodes: N_NODES,
    perTechniqueBudget: 1,
    enableConcurrency: opts.maxConcurrency > 1,
    maxConcurrency: opts.maxConcurrency,
    sleepBetweenNodesMs: opts.sleepBetweenNodesMs,
    onFinding: (f) => console.log(`[${label}]   finding: ${f.type} severity=${f.severity} endpoint=${f.endpoint}`),
    onLog: (m) => { if (m.includes('rate-limited')) console.log(`[${label}]   ${m}`); },
  });
  const t0 = Date.now();
  const result = await orch.run();
  const elapsed = Date.now() - t0;
  await pool.closeAll();
  const row = {
    label,
    maxConcurrency: opts.maxConcurrency,
    sleepBetweenNodesMs: opts.sleepBetweenNodesMs,
    durationMs: result.durationMs,
    wallClockMs: elapsed,
    completedNodes: result.completedNodes,
    failedNodes: result.failedNodes,
    findings: result.findings.length,
    effectiveMaxConcurrency: result.effectiveMaxConcurrency,
    rateLimitEvents: result.rateLimitEvents,
    workerInvocations: stats.invocations,
    peakInflight: stats.peakInflight,
    vulnsFound: stats.vulnsFound,
  };
  console.log(`[${label}]   → durationMs=${row.durationMs}  completed=${row.completedNodes}/${N_NODES}  findings=${row.findings}  effectiveConc=${row.effectiveMaxConcurrency}  peakInflight=${row.peakInflight}  rateLimitEvents=${row.rateLimitEvents}  vulnsFound=${row.vulnsFound}`);
  return row;
}

(async () => {
  const throttled = await runMode('throttled', { maxConcurrency: 1, sleepBetweenNodesMs: 1000 });
  const maxThrottle = await runMode('max', { maxConcurrency: 4, sleepBetweenNodesMs: 0 });

  console.log('\n=== Comparison ===');
  const cols = ['label', 'maxConcurrency', 'sleepBetweenNodesMs', 'durationMs', 'completedNodes', 'findings', 'effectiveMaxConcurrency', 'peakInflight', 'rateLimitEvents', 'vulnsFound'];
  console.log(cols.join('\t'));
  for (const r of [throttled, maxThrottle]) {
    console.log(cols.map((c) => String(r[c])).join('\t'));
  }
  const speedup = throttled.durationMs > 0 ? (throttled.durationMs / Math.max(1, maxThrottle.durationMs)).toFixed(2) : 'n/a';
  console.log(`\nMax-throttle speedup over throttled: ${speedup}x`);
  process.exit(0);
})();
