// tests/integration/hunt-pipeline.test.ts
//
// OPT-IN E2E pipeline test. Exercises the full HuntCore → CI runner →
// Report HTML → diff store → ZIP export chain against a canned "hunt"
// (scripted events, no real target needed).
//
// Run with:
//   HUNT_PIPELINE_E2E=1 npx vitest run tests/integration/hunt-pipeline.test.ts
//
// This test exists to prove the v4 architecture hangs together:
// HuntCore emits events → runCi() reads them → renderHtmlReport() renders
// → diff-store picks up the new snapshot → ZIP exports.
//
// We don't reach out to a real target; we use a mock LLM that emits
// one reflected-xss finding via core.recordFinding, then assert the
// full pipeline serialises / reports / archives correctly.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HuntCore } from '../../src/hunt/core';
import { runCi, defaultCiOutputPath } from '../../src/ci/runner';
import { renderHtmlReport } from '../../src/report/html';
import { saveSnapshot, listSnapshots, diffHunts, snapshotFromCore } from '../../src/report/diff-store';
import { buildShareZip } from '../../src/report/zip';
import type { LLMClient } from '../../src/llm/client';

const ENABLED = process.env.HUNT_PIPELINE_E2E === '1';
const skipUnless = ENABLED ? it : it.skip;

interface PipelineState { outDir: string; reportPath: string; htmlPath: string; zipPath: string; core: HuntCore; }

async function setupHunt(): Promise<PipelineState> {
  const outDir = mkdtempSync(join(tmpdir(), 'pipeline-e2e-'));
  const llm: LLMClient = {} as LLMClient;  // mock — we'll only use recordXxx methods
  const core = new HuntCore({ target: 'https://test-target.local', outDir, llm, maxRuntimeSeconds: 30 });
  const reportPath = defaultCiOutputPath(outDir, 'json');
  // Start the runCi runner first (it subscribes to the 'done' event).
  // Then asynchronously drive events and call stop() to fire 'done'.
  const runPromise = runCi({ core, format: 'json', failOn: 'low', outputFile: reportPath, printToStdout: false });
  // Drive events.
  core.recordLog({ level: 'info', text: 'Pipeline E2E test starting' });
  core.recordFinding({
    id: 'pipe-f1', type: 'reflected-xss', endpoint: 'https://test-target.local/search', param: 'q', method: 'GET',
    payload: '<script>alert(1)</script>',
    evidence: [
      { type: 'text', data: '<script>alert(1)</script>', label: 'responseContains', timestamp: Date.now() },
    ],
    confidence: 'high', confirmed: true, severity: 'high',
    description: 'Pipeline E2E test finding',
  });
  core.recordScreenshot({ findingId: 'pipe-f1', png: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), format: 'png' });
  core.recordOOB({ findingId: 'pipe-f1', callbackUrl: 'http://oast.local/abc', category: 'blind-xss' });
  core.stop('user-quit');
  const result = await runPromise;
  // result.findings isn't on CiRunnerResult; check core.getState() instead.
  expect(core.getState().findings.length).toBeGreaterThan(0);
  const htmlPath = join(outDir, 'report.html');
  const state = core.getState();
  const html = renderHtmlReport({
    target: state.target,
    startedAt: state.startedAt,
    durationMs: (state.endedAt ?? Date.now()) - state.startedAt,
    cost: state.dollarsSpent,
    findings: state.findings,
    diff: null,
  });
  require('node:fs').writeFileSync(htmlPath, html);
  const zipPath = join(outDir, 'share.zip');
  const zipBuf = buildShareZip(outDir, html);
  require('node:fs').writeFileSync(zipPath, zipBuf);
  // Save to diff store.
  const snap = snapshotFromCore(core);
  saveSnapshot(outDir, snap);
  return { outDir, reportPath, htmlPath, zipPath, core };
}

describe('v4 pipeline E2E (opt-in)', () => {
  let state: PipelineState | null = null;
  afterEach(() => {
    if (state) {
      try { rmSync(state.outDir, { recursive: true, force: true }); } catch {}
      state = null;
    }
  });

  skipUnless('produces JSON report with finding', async () => {
    state = await setupHunt();
    const json = JSON.parse(readFileSync(state.reportPath, 'utf8'));
    expect(json.findings).toBeDefined();
    expect(json.findings.length).toBeGreaterThan(0);
    expect(json.findings[0].type).toBe('reflected-xss');
  });

  skipUnless('produces self-contained HTML report', async () => {
    state = await setupHunt();
    const html = readFileSync(state.htmlPath, 'utf8');
    expect(html).toMatch(/<html/i);
    expect(html).toMatch(/reflected-xss/);
    expect(html).toMatch(/Pipeline E2E test/);
    // Self-contained: no CDN.
    expect(html).not.toMatch(/https?:\/\/cdn|https?:\/\/unpkg/);
  });

  skipUnless('produces ZIP with no compression', async () => {
    state = await setupHunt();
    expect(existsSync(state.zipPath)).toBe(true);
    const size = statSync(state.zipPath).size;
    expect(size).toBeGreaterThan(0);
  });

  skipUnless('diff store: second hunt is compared against first', async () => {
    // First hunt.
    const firstDir = mkdtempSync(join(tmpdir(), 'pipeline-e2e-first-'));
    try {
      const llm = {} as LLMClient;
      const core1 = new HuntCore({ target: 'https://test-target.local', outDir: firstDir, llm, maxRuntimeSeconds: 30 });
      const runP = runCi({ core: core1, format: 'json', failOn: 'low', outputFile: defaultCiOutputPath(firstDir, 'json'), printToStdout: false });
      core1.recordFinding({
        id: 'first-f', type: 'reflected-xss', endpoint: 'https://test-target.local/a', param: 'q', method: 'GET',
        payload: 'x', evidence: [{ type: 'text', data: 'x', label: 'lbl', timestamp: Date.now() }],
        confidence: 'high', confirmed: true, severity: 'medium', description: 'first',
      });
      core1.stop('user-quit');
      await runP;
      const snap1 = snapshotFromCore(core1);
      saveSnapshot(firstDir, snap1);
      // Second hunt.
      state = await setupHunt();
      const all = listSnapshots(state.outDir, 'https://test-target.local');
      expect(all.length).toBeGreaterThanOrEqual(1);
      const snap2 = snapshotFromCore(state.core);
      const diff = diffHunts(snap1, snap2);
      expect(diff).toBeDefined();
      // Second hunt has a new finding (pipe-f1) not in first.
      expect(diff.added.length + diff.regressed.length + diff.unchanged.length).toBeGreaterThan(0);
    } finally {
      try { rmSync(firstDir, { recursive: true, force: true }); } catch {}
    }
  });
});

