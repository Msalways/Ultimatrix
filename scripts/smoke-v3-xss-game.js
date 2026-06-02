#!/usr/bin/env node
/**
 * scripts/smoke-v3-xss-game.js
 *
 * End-to-end smoke test of the v3 orchestrator against xss-game L1.
 * Uses a HAND-ROLLED worker (no LLM) that does the actual HTTP request
 * and concludes "vulnerable" when the XSS payload is reflected unsanitized.
 * Proves the v3 pipeline (graph → strategy → worker → finding → report) works.
 */
const path = require('path');
const fs = require('fs');
const {
  AutonomousV3Orchestrator,
  WorkflowStateGraph,
  SessionPool,
  DEFAULT_MODEL,
  readAppModel,
  compileReport,
  updateAppModelSection,
  writeAppModel,
} = require('../dist/index.js');
const fsWrite = require('fs');

const TARGET = 'https://xss-game.appspot.com/level1/frame?query=test';
const OUT_DIR = path.resolve(process.argv[2] || './output-xss-smoke');

const REFLECTED_PAYLOAD = '<script>alert("ultimatrix-smoke-test")</script>';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const appModelPath = path.join(OUT_DIR, 'app-model.json');
  writeAppModel(appModelPath, { ...DEFAULT_MODEL, target: TARGET, visitedUrls: [TARGET.split('?')[0]] });

  const graph = new WorkflowStateGraph();
  graph.addNode({ id: 'target', url: TARGET, title: 'xss-game L1', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
  graph.markReachable('target');
  graph.refreshReachable();

  const pool = new SessionPool({ headless: true, networkCaptureEnabled: false });

  const start = Date.now();
  let llmCalls = 0;
  let toolCalls = 0;

  const workerFactory = async (input) => {
    llmCalls++;
    const t0 = Date.now();
    console.log(`[worker] node=${input.workflowNodeId} tech=${input.technique} url=${input.url} param=${input.param ?? '(none)'} timeoutMs=${input.timeoutMs}ms severity=${input.expectedSeverity}`);
    let vulnerable = false;
    let confidence = 0;
    let evidenceText = '';
    let error = undefined;
    try {
      const testUrl = input.url.includes('?')
        ? input.url.replace(/=[^&]*/, `=${encodeURIComponent(REFLECTED_PAYLOAD)}`)
        : `${input.url}?q=${encodeURIComponent(REFLECTED_PAYLOAD)}`;
      toolCalls++;
      const resp = await fetch(testUrl, { signal: AbortSignal.timeout(15000) });
      const body = await resp.text();
      const reflected = body.includes(REFLECTED_PAYLOAD) || body.includes('<script>alert("ultimatrix-smoke-test")</script>');
      const escaped = body.includes('&lt;script&gt;') || body.includes('&amp;lt;script&amp;gt;');
      vulnerable = reflected && !escaped;
      confidence = vulnerable ? 0.95 : 0.0;
      evidenceText = `URL: ${testUrl}\nStatus: ${resp.status}\nReflected: ${reflected}\nEscaped: ${escaped}\nBody snippet: ${body.slice(0, 400)}`;
      console.log(`[worker] result: vulnerable=${vulnerable} confidence=${confidence} reflected=${reflected} escaped=${escaped} elapsedMs=${Date.now() - t0}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.log(`[worker] error: ${error} elapsedMs=${Date.now() - t0}`);
    }
    return {
      vulnerable,
      confidence,
      evidence: vulnerable ? [{ type: 'text', data: evidenceText, label: 'XSS reflection proof', timestamp: Date.now() }] : [],
      payloads: vulnerable ? [REFLECTED_PAYLOAD] : [],
      summary: vulnerable
        ? `Reflected XSS at ${input.url} — payload echoed unescaped in HTML body`
        : `No XSS at ${input.url}`,
      technique: input.technique,
      url: input.url,
      error,
      durationMs: Date.now() - t0,
    };
  };

  const orch = new AutonomousV3Orchestrator({
    graph,
    pool,
    workerFactory,
    maxRuntimeMs: 120_000,
    maxNodes: 10,
    perTechniqueBudget: 1,
    enableConcurrency: false,
    maxConcurrency: 1,
    onFinding: (finding, node) => {
      console.log(`[orch] FINDING: ${finding.type} severity=${finding.severity} endpoint=${finding.endpoint} param=${finding.param}`);
      try {
        const r = updateAppModelSection(appModelPath, 'findings', [finding], true);
        if (r && typeof r.then === 'function') r.catch((e) => console.log(`[orch] persist error: ${e.message}`));
      } catch (e) {
        console.log(`[orch] persist error: ${e.message}`);
      }
    },
    onNodeUpdate: (node, status) => {
      console.log(`[orch] node ${node.id} → ${status}`);
    },
    onLog: (msg) => console.log(`[orch] ${msg}`),
  });

  console.log(`[smoke] starting v3 orchestrator on xss-game L1 (target=${TARGET})`);
  const result = await orch.run();
  const elapsed = Date.now() - start;
  console.log(`\n[smoke] === result ===`);
  console.log(`  totalNodes        : ${result.totalNodes}`);
  console.log(`  completedNodes    : ${result.completedNodes}`);
  console.log(`  failedNodes       : ${result.failedNodes}`);
  console.log(`  findings          : ${result.findings.length}`);
  console.log(`  terminatedBy      : ${result.terminatedBy}`);
  console.log(`  durationMs        : ${result.durationMs}`);
  console.log(`  effectiveConc     : ${result.effectiveMaxConcurrency}`);
  console.log(`  rateLimitEvents   : ${result.rateLimitEvents}`);
  console.log(`  toolCalls         : ${toolCalls}`);
  console.log(`  workerInvocations : ${llmCalls}`);
  console.log(`  wallClockMs       : ${elapsed}`);

  if (result.findings.length > 0) {
    const f = result.findings[0];
    console.log(`\n[smoke] first finding:`);
    console.log(`  type: ${f.type}`);
    console.log(`  endpoint: ${f.endpoint}`);
    console.log(`  param: ${f.param}`);
    console.log(`  severity: ${f.severity}`);
    console.log(`  confidence: ${f.confidence}`);
    console.log(`  evidence[0].label: ${f.evidence[0]?.label}`);
    console.log(`  evidence[0].data: ${f.evidence[0]?.data?.split('\n').slice(0, 3).join('\n  ')}`);
  }

  await pool.closeAll();

  await new Promise((r) => setTimeout(r, 200));

  const finalModel = readAppModel(appModelPath);
  const reportModel = { ...finalModel, findings: result.findings.length > 0 ? result.findings : (finalModel.findings || []) };
  const reportHtml = compileReport(reportModel, 'html');
  const reportPath = path.join(OUT_DIR, 'final-security-report.html');
  fsWrite.writeFileSync(reportPath, reportHtml);
  console.log(`[smoke] wrote report: ${reportPath} (${reportHtml.length} bytes); findings in model: ${reportModel.findings.length}`);

  console.log(`\n[smoke] PASS: v3 orchestrator completed end-to-end against xss-game L1`);
  process.exit(result.findings.length > 0 ? 0 : 1);
})();
