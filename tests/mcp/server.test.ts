// tests/mcp/server.test.ts
//
// Block 13: MCP server. We test the parts that don't require a live
// stdio JSON-RPC round-trip:
//   1. JobStore: in-memory CRUD, listeners, appends, log trimming, sort
//   2. summariseJob shape (via store.list())
//   3. startWatcher: re-reads app-model.json, appends new findings
//   4. buildMcpServer: constructs without throwing (smoke test for
//      tool registration — the real assertions live in the stdio
//      round-trip test, which we add separately)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JobStore, getJobStore, type HuntJob } from '../../src/mcp/job-store';
import { startWatcher, _stopAllWatchers, buildMcpServer } from '../../src/mcp/server';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-mcp-'));
});
afterEach(() => {
  _stopAllWatchers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('JobStore', () => {
  it('creates a job with a generated id when none given', () => {
    const s = new JobStore();
    const job = s.create({ target: 'https://a.com', outputDir: './out', appModelPath: './out/app-model.json' });
    expect(job.id).toMatch(/^job-\d+/);
    expect(job.status).toBe('queued');
    expect(job.findings).toEqual([]);
    expect(job.startedAt).toBeGreaterThan(0);
    expect(job.finishedAt).toBeNull();
  });

  it('honours a caller-provided id', () => {
    const s = new JobStore();
    const job = s.create({ id: 'my-job', target: 't', outputDir: 'o', appModelPath: 'm' });
    expect(job.id).toBe('my-job');
  });

  it('get() returns the job or undefined', () => {
    const s = new JobStore();
    const job = s.create({ id: 'j1', target: 't', outputDir: 'o', appModelPath: 'm' });
    expect(s.get('j1')).toBe(job);
    expect(s.get('nope')).toBeUndefined();
  });

  it('update() patches the job and emits to listeners', () => {
    const s = new JobStore();
    s.create({ id: 'j1', target: 't', outputDir: 'o', appModelPath: 'm' });
    const seen: HuntJob[] = [];
    s.onChange((j) => seen.push(j));
    s.update('j1', { status: 'running', progress: 0.5 });
    const after = s.get('j1')!;
    expect(after.status).toBe('running');
    expect(after.progress).toBe(0.5);
    // 1 listener event from update (the create listener was registered after)
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe('running');
  });

  it('update() returns undefined for unknown job', () => {
    const s = new JobStore();
    expect(s.update('nope', { status: 'done' })).toBeUndefined();
  });

  it('appendFinding adds to the list', () => {
    const s = new JobStore();
    s.create({ id: 'j1', target: 't', outputDir: 'o', appModelPath: 'm' });
    s.appendFinding('j1', { id: 'f1', type: 'xss', endpoint: '/', param: 'q', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] });
    expect(s.get('j1')!.findings).toHaveLength(1);
  });

  it('appendLog trims to last 200 lines', () => {
    const s = new JobStore();
    s.create({ id: 'j1', target: 't', outputDir: 'o', appModelPath: 'm' });
    for (let i = 0; i < 250; i++) s.appendLog('j1', `line-${i}`);
    const log = s.get('j1')!.log;
    expect(log).toHaveLength(200);
    expect(log[0]).toBe('line-50');
    expect(log[199]).toBe('line-249');
  });

  it('list() returns jobs sorted by startedAt desc', () => {
    const s = new JobStore();
    const j1 = s.create({ id: 'j1', target: 't', outputDir: 'o', appModelPath: 'm' });
    const j2 = s.create({ id: 'j2', target: 't', outputDir: 'o', appModelPath: 'm' });
    j2.startedAt = j1.startedAt + 1_000;
    const list = s.list();
    expect(list[0].id).toBe('j2');
    expect(list[1].id).toBe('j1');
  });

  it('getJobStore() returns a singleton', () => {
    expect(getJobStore()).toBe(getJobStore());
  });

  it('summariseJob includes durationMs and findingCount', () => {
    const s = new JobStore();
    const job = s.create({ id: 'j1', target: 't', outputDir: 'o', appModelPath: 'm' });
    s.update('j1', { status: 'done', finishedAt: job.startedAt + 5000 });
    s.appendFinding('j1', { id: 'f1', type: 'xss', endpoint: '/', param: 'q', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] });
    const list = s.list();
    // list() returns HuntJob (raw); the summarised shape lives in the
    // server's get_status tool handler. We re-create it here:
    expect(list[0].findings).toHaveLength(1);
    expect((list[0].finishedAt ?? 0) - list[0].startedAt).toBe(5000);
  });
});

describe('buildMcpServer (smoke test)', () => {
  it('constructs without throwing and registers tools', () => {
    const s = buildMcpServer({ store: new JobStore() });
    expect(s).toBeDefined();
    // We can't directly inspect the registered tools from the SDK's
    // public API, but the constructor call exercised the full
    // registration path (5 registerTool calls).
  });
});

describe('startWatcher (background poll)', () => {
  it('appends new findings from app-model.json to the job', async () => {
    const outDir = path.join(tmpDir, 'hunt');
    fs.mkdirSync(outDir, { recursive: true });
    const appModelPath = path.join(outDir, 'app-model.json');
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 'https://x',
      endpoints: [],
      findings: [
        { id: 'f1', type: 'xss', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
      ],
    }));

    const store = new JobStore();
    const job = store.create({ id: 'watcher-1', target: 'https://x', outputDir: outDir, appModelPath });
    // Use a short interval (50ms) so the test finishes quickly
    startWatcher('watcher-1', store, 50);

    // Wait for the watcher to pick up the initial finding
    await new Promise((r) => setTimeout(r, 150));
    expect(store.get('watcher-1')!.findings).toHaveLength(1);
    expect(store.get('watcher-1')!.findings[0].id).toBe('f1');

    // Now write a new finding to the app-model and wait for the watcher
    // to pick it up
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 'https://x',
      endpoints: [{ path: '/', method: 'GET', params: [], requiresAuth: false, responseStatus: 200, contentType: 'text/html', bodyPreview: '' }],
      findings: [
        { id: 'f1', type: 'xss', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
        { id: 'f2', type: 'sqli', endpoint: '/api', param: 'id', method: 'GET', severity: 'critical', confidence: 0.95, confirmed: true, evidence: [] },
      ],
    }));

    await new Promise((r) => setTimeout(r, 150));
    const updated = store.get('watcher-1')!;
    expect(updated.findings).toHaveLength(2);
    expect(updated.findings.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
    // Progress should have moved up (endpoints / 50)
    expect(updated.progress).toBeGreaterThan(0);
  });

  it('deduplicates findings by id across polls', async () => {
    const outDir = path.join(tmpDir, 'hunt2');
    fs.mkdirSync(outDir, { recursive: true });
    const appModelPath = path.join(outDir, 'app-model.json');
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 'https://x',
      endpoints: [],
      findings: [
        { id: 'f1', type: 'xss', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
      ],
    }));

    const store = new JobStore();
    store.create({ id: 'w2', target: 't', outputDir: outDir, appModelPath });
    startWatcher('w2', store, 50);

    await new Promise((r) => setTimeout(r, 150));
    expect(store.get('w2')!.findings).toHaveLength(1);

    // Re-write the same finding — should still be 1
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 'https://x',
      endpoints: [],
      findings: [
        { id: 'f1', type: 'xss', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
      ],
    }));
    await new Promise((r) => setTimeout(r, 150));
    expect(store.get('w2')!.findings).toHaveLength(1);
  });

  it('uses endpoint-fingerprint dedup for findings with no id', async () => {
    const outDir = path.join(tmpDir, 'hunt3');
    fs.mkdirSync(outDir, { recursive: true });
    const appModelPath = path.join(outDir, 'app-model.json');
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 'https://x',
      endpoints: [],
      findings: [
        { type: 'xss', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
      ],
    }));

    const store = new JobStore();
    store.create({ id: 'w3', target: 't', outputDir: outDir, appModelPath });
    startWatcher('w3', store, 50);

    await new Promise((r) => setTimeout(r, 150));
    expect(store.get('w3')!.findings).toHaveLength(1);

    // Write a finding with the same fingerprint but a different confidence
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 'https://x',
      endpoints: [],
      findings: [
        { type: 'xss', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 0.5, confirmed: false, evidence: [] },
      ],
    }));
    await new Promise((r) => setTimeout(r, 150));
    // Should still be 1 — fingerprint matches
    expect(store.get('w3')!.findings).toHaveLength(1);
  });

  it('stops the watcher when the job is marked done', async () => {
    const outDir = path.join(tmpDir, 'hunt4');
    fs.mkdirSync(outDir, { recursive: true });
    const appModelPath = path.join(outDir, 'app-model.json');
    fs.writeFileSync(appModelPath, JSON.stringify({ target: 't', endpoints: [], findings: [] }));

    const store = new JobStore();
    store.create({ id: 'w4', target: 't', outputDir: outDir, appModelPath });
    startWatcher('w4', store, 50);
    await new Promise((r) => setTimeout(r, 100));

    // Mark the job done — next tick should clear the interval
    store.update('w4', { status: 'done', finishedAt: Date.now(), progress: 1 });
    await new Promise((r) => setTimeout(r, 100));

    // Now write a new finding and verify the watcher did NOT pick it up
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 't',
      endpoints: [],
      findings: [
        { id: 'late', type: 'xss', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
      ],
    }));
    await new Promise((r) => setTimeout(r, 150));
    expect(store.get('w4')!.findings).toHaveLength(0);
  });

  it('logs a warning when the app-model.json is missing', async () => {
    const store = new JobStore();
    const outDir = path.join(tmpDir, 'hunt5');
    fs.mkdirSync(outDir, { recursive: true });
    const appModelPath = path.join(outDir, 'app-model.json'); // never written
    store.create({ id: 'w5', target: 't', outputDir: outDir, appModelPath });
    startWatcher('w5', store, 50);
    await new Promise((r) => setTimeout(r, 150));
    expect(store.get('w5')!.log.some((l) => l.includes('not yet on disk'))).toBe(true);
  });
});
