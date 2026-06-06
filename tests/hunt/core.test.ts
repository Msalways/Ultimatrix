// tests/hunt/core.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HuntCore } from '../../src/hunt/core';
import { createMockLLMClient } from '../helpers/mock-llm';
import type { AppModelFinding } from '../../src/core/app-model';

let dir: string;
let llm: ReturnType<typeof createMockLLMClient>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hunt-'));
  llm = createMockLLMClient();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('HuntCore', () => {
  it('starts in starting phase, moves to observing', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    expect(c.getState().phase).toBe('starting');
    c.start();
    expect(c.getState().phase).toBe('observing');
    c.stop('user-quit');
    expect(c.getState().phase).toBe('done');
  });

  it('emits phase events on start', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    const events: string[] = [];
    c.on((e) => events.push(e.type));
    c.start();
    c.stop('user-quit');
    expect(events).toContain('phase');
    expect(events).toContain('done');
  });

  it('stop emits done event with summary', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    let summary: { findingsCount: number; totalSteps: number } | undefined;
    c.on((e) => {
      if (e.type === 'done') summary = { findingsCount: e.summary.findingsCount, totalSteps: e.summary.totalSteps };
    });
    c.start();
    c.stop('user-quit');
    expect(summary).toBeDefined();
    expect(summary!.findingsCount).toBe(0);
  });

  it('dedups findings by (type, endpoint, param)', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    const f: AppModelFinding = {
      id: 'f1',
      type: 'reflected-xss',
      endpoint: 'https://x.com/search',
      param: 'q',
      evidence: {},
      confidence: 'high',
      confirmed: true,
      severity: 'high',
    };
    expect(c.recordFinding(f)).toBe(true);
    expect(c.recordFinding({ ...f, id: 'f2' })).toBe(false);
    expect(c.getState().findings.length).toBe(1);
    c.stop('user-quit');
  });

  it('keeps findings with different params', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    c.recordFinding({ id: '1', type: 'xss', endpoint: '/s', param: 'a', evidence: {}, confidence: 'high', confirmed: true, severity: 'high' });
    c.recordFinding({ id: '2', type: 'xss', endpoint: '/s', param: 'b', evidence: {}, confidence: 'high', confirmed: true, severity: 'high' });
    expect(c.getState().findings.length).toBe(2);
    c.stop('user-quit');
  });

  it('writes a live spec file on start', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    const livePath = join(dir, 'live.spec.ts');
    expect(existsSync(livePath)).toBe(true);
    c.stop('user-quit');
    const content = readFileSync(livePath, 'utf8');
    expect(content).toContain("await page.goto('https://x.com'");
    expect(content).toMatch(/^}\);$/m);
  });

  it('writes findings to the live spec', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    c.recordFinding({ id: '1', type: 'reflected-xss', endpoint: 'https://x.com/q', param: 'q', evidence: {}, confidence: 'high', confirmed: true, severity: 'high' });
    c.stop('user-quit');
    const content = readFileSync(join(dir, 'live.spec.ts'), 'utf8');
    expect(content).toContain('reflected-xss');
  });

  it('writes a JSONL file when writeJsonl is on', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60, writeJsonl: true });
    c.start();
    c.getRecorder()?.recordNavigate('https://x.com/x', 'hard');
    c.getRecorder()?.recordClick('#btn');
    c.stop('user-quit');
    expect(existsSync(join(dir, 'behavioral.jsonl'))).toBe(true);
    const content = readFileSync(join(dir, 'behavioral.jsonl'), 'utf8');
    expect(content).toContain('"type":"navigate"');
    expect(content).toContain('"type":"click"');
  });

  it('emits primitive-call event when recordPrimitiveCall is called', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    let seen = false;
    c.on((e) => { if (e.type === 'primitive-call') seen = true; });
    c.recordPrimitiveCall({
      id: 'p1', agentId: 'a1', primitive: 'httpRequest', args: { method: 'GET', url: 'https://x' },
      startedAt: Date.now(), endedAt: Date.now(), result: { status: 200 },
    });
    expect(seen).toBe(true);
    c.stop('user-quit');
  });

  it('emits oob-callback and increments counter', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    let seen = false;
    c.on((e) => { if (e.type === 'oob-callback') seen = true; });
    c.recordOOB({ url: 'http://oast.test/x', source: 'blind-xss', bodyPreview: 'ok', headers: {}, receivedAt: Date.now() });
    expect(seen).toBe(true);
    expect(c.getState().oobCallbackCount).toBe(1);
    c.stop('user-quit');
  });

  it('summary counts findings by severity and type', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    c.recordFinding({ id: '1', type: 'xss', endpoint: '/a', param: 'q', evidence: {}, confidence: 'high', confirmed: true, severity: 'high' });
    c.recordFinding({ id: '2', type: 'xss', endpoint: '/b', param: 'q', evidence: {}, confidence: 'high', confirmed: true, severity: 'high' });
    c.recordFinding({ id: '3', type: 'sqli', endpoint: '/c', param: 'q', evidence: {}, confidence: 'high', confirmed: true, severity: 'critical' });
    const summary = c.stop('user-quit');
    expect(summary.findingsCount).toBe(3);
    expect(summary.findingsByType.xss).toBe(2);
    expect(summary.findingsByType.sqli).toBe(1);
    expect(summary.findingsBySeverity.high).toBe(2);
    expect(summary.findingsBySeverity.critical).toBe(1);
  });

  it('stop can only be called once', () => {
    const c = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    c.start();
    c.stop('user-quit');
    const second = c.stop('user-quit');
    expect(second.terminationReason ?? second).toBeDefined();
  });

  it('creates the outDir if it does not exist', () => {
    const newDir = join(dir, 'subdir', 'more');
    expect(existsSync(newDir)).toBe(false);
    const c = new HuntCore({ target: 'https://x.com', outDir: newDir, llm, maxRuntimeSeconds: 60 });
    c.start();
    c.stop('user-quit');
    expect(existsSync(newDir)).toBe(true);
  });
});
