// tests/report/diff-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot, loadLatestSnapshot, listSnapshots, diffHunts, fingerprint, snapshotFromCore } from '../../src/report/diff-store';
import { HuntCore } from '../../src/hunt/core';
import { createMockLLMClient } from '../helpers/mock-llm';
import type { AppModelFinding } from '../../src/core/app-model';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'diff-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function f(overrides: Partial<AppModelFinding> = {}): AppModelFinding {
  return { id: 'f', type: 'xss', endpoint: '/x', param: 'q', method: 'GET', evidence: {}, confidence: 'high', confirmed: true, severity: 'high', ...overrides };
}

describe('Diff store', () => {
  it('fingerprint is stable for same finding', () => {
    const a = f({ type: 'xss', endpoint: '/x', param: 'q' });
    const b = f({ type: 'xss', endpoint: '/x', param: 'q' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('fingerprint changes when param changes', () => {
    const a = f({ param: 'q' });
    const b = f({ param: 'p' });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('saveSnapshot writes JSON', () => {
    const path = saveSnapshot(dir, {
      target: 'https://x.com', timestamp: 1000, durationMs: 500,
      findings: [{ type: 'x', endpoint: '/', param: 'q', method: 'GET', severity: 'high', confidence: 'high', confirmed: true, fingerprint: 'x|/|q|GET' }],
    });
    expect(existsSync(path)).toBe(true);
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.target).toBe('https://x.com');
  });

  it('loadLatestSnapshot returns null when none', () => {
    expect(loadLatestSnapshot(dir, 'https://x.com')).toBeNull();
  });

  it('loadLatestSnapshot returns the most recent', () => {
    saveSnapshot(dir, { target: 'https://x.com', timestamp: 1000, durationMs: 100, findings: [] });
    saveSnapshot(dir, { target: 'https://x.com', timestamp: 2000, durationMs: 100, findings: [] });
    const latest = loadLatestSnapshot(dir, 'https://x.com');
    expect(latest?.timestamp).toBe(2000);
  });

  it('listSnapshots returns all in order', () => {
    saveSnapshot(dir, { target: 'https://x.com', timestamp: 1000, durationMs: 100, findings: [] });
    saveSnapshot(dir, { target: 'https://x.com', timestamp: 2000, durationMs: 100, findings: [] });
    const all = listSnapshots(dir, 'https://x.com');
    expect(all).toHaveLength(2);
    expect(all[0].timestamp).toBe(1000);
    expect(all[1].timestamp).toBe(2000);
  });

  it('diffHunts: no previous snapshot -> all current are "added"', () => {
    const diff = diffHunts(null, { findings: [f()], timestamp: 100, target: 't' });
    expect(diff.added).toHaveLength(1);
    expect(diff.fixed).toHaveLength(0);
  });

  it('diffHunts: identical findings are "unchanged"', () => {
    const prev = { target: 't', timestamp: 100, durationMs: 0, findings: [{ type: 'xss', endpoint: '/x', param: 'q', method: 'GET', severity: 'high', confidence: 'high', confirmed: true, fingerprint: 'xss|/x|q|GET' }] };
    const diff = diffHunts(prev, { findings: [f()], timestamp: 200, target: 't' });
    expect(diff.added).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });

  it('diffHunts: missing in current is "fixed"', () => {
    const prev = { target: 't', timestamp: 100, durationMs: 0, findings: [{ type: 'xss', endpoint: '/x', param: 'q', method: 'GET', severity: 'high', confidence: 'high', confirmed: true, fingerprint: 'xss|/x|q|GET' }] };
    const diff = diffHunts(prev, { findings: [], timestamp: 200, target: 't' });
    expect(diff.fixed).toHaveLength(1);
    expect(diff.removedFingerprints).toHaveLength(1);
  });

  it('diffHunts: severity-escalated is "regressed"', () => {
    const prev = { target: 't', timestamp: 100, durationMs: 0, findings: [{ type: 'xss', endpoint: '/x', param: 'q', method: 'GET', severity: 'low', confidence: 'high', confirmed: true, fingerprint: 'xss|/x|q|GET' }] };
    const diff = diffHunts(prev, { findings: [f({ severity: 'critical' })], timestamp: 200, target: 't' });
    expect(diff.regressed).toHaveLength(1);
  });

  it('diffHunts: new type is "added"', () => {
    const prev = { target: 't', timestamp: 100, durationMs: 0, findings: [] };
    const diff = diffHunts(prev, { findings: [f()], timestamp: 200, target: 't' });
    expect(diff.added).toHaveLength(1);
  });

  it('snapshotFromCore builds a snapshot', () => {
    const core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
    core.start();
    core.recordFinding(f());
    core.stop('user-quit');
    const snap = snapshotFromCore(core);
    expect(snap.findings).toHaveLength(1);
    expect(snap.findings[0].fingerprint).toBe('xss|/x|q|GET');
  });

  it('end-to-end: save, reload, diff', () => {
    const core1 = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
    core1.start();
    core1.recordFinding(f({ id: 'f1' }));
    core1.stop('user-quit');
    const snap1 = snapshotFromCore(core1);
    saveSnapshot(dir, snap1);
    const core2 = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
    core2.start();
    core2.recordFinding(f({ id: 'f2' }));
    core2.recordFinding(f({ id: 'f3', type: 'sqli', endpoint: '/y' }));
    core2.stop('user-quit');
    const prev = loadLatestSnapshot(dir, 'https://x.com')!;
    const diff = diffHunts(prev, { findings: [
      f({ id: 'f2' }),
      f({ id: 'f3', type: 'sqli', endpoint: '/y' }),
    ], timestamp: Date.now(), target: 'https://x.com' });
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.added).toHaveLength(1);
  });
});
