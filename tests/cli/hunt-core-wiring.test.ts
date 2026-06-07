// tests/cli/hunt-core-wiring.test.ts
//
// Block 14: HuntCore as the single source of truth. The wiring helper
// (`src/cli/hunt-core-wiring.ts`) bridges the v3 hunt's per-callback
// hooks (onFinding, onPrimitive, onChat) to the v4 HuntCore's
// `recordXxx()` methods. These tests cover:
//
//   - The wiring shape: every callback exists and is callable.
//   - onFinding -> core.recordFinding with dedup
//   - onPrimitive -> core.recordPrimitiveCall with stamped metadata
//   - onChat/onLog/onOOB/onScreenshot -> the corresponding record methods
//   - onHuntEnd / onFindingDeduped listeners
//   - unsubscribe is idempotent
//   - The wiring composes with a HuntCore that is already running
//     (the realistic case in runHunt: core.start() happens before
//     wireHuntCore).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HuntCore } from '../../src/hunt/core';
import { wireHuntCore } from '../../src/cli/hunt-core-wiring';
import { createMockLLMClient } from '../helpers/mock-llm';
import type { AppModelFinding } from '../../src/core/app-model';

let dir: string;
let llm: ReturnType<typeof createMockLLMClient>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wiring-'));
  llm = createMockLLMClient();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCore(): HuntCore {
  return new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
}

function makeFinding(overrides: Partial<AppModelFinding> = {}): AppModelFinding {
  return {
    type: 'reflected-xss',
    endpoint: 'https://x.com/api?query=foo',
    param: 'query',
    method: 'GET',
    payload: '<script>alert(1)</script>',
    evidence: [{ type: 'text', data: '<script>', label: 'responseContains', timestamp: Date.now() }],
    confidence: 0.95,
    confirmed: true,
    severity: 'high',
    description: 'reflected XSS in query param',
    ...overrides,
  };
}

describe('wireHuntCore — shape', () => {
  it('returns onFinding, onPrimitive, onChat, onLog, onOOB, onScreenshot, unsubscribe', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    expect(typeof w.onFinding).toBe('function');
    expect(typeof w.onPrimitive).toBe('function');
    expect(typeof w.onChat).toBe('function');
    expect(typeof w.onLog).toBe('function');
    expect(typeof w.onOOB).toBe('function');
    expect(typeof w.onScreenshot).toBe('function');
    expect(typeof w.unsubscribe).toBe('function');
    w.unsubscribe();
  });
});

describe('wireHuntCore.onFinding', () => {
  it('forwards a new finding to core.recordFinding and returns true', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    const added = w.onFinding(makeFinding());
    expect(added).toBe(true);
    expect(core.getState().findings).toHaveLength(1);
    expect(core.getState().findings[0].type).toBe('reflected-xss');
    w.unsubscribe();
  });

  it('dedupes by (type, endpoint, param) and returns false', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    expect(w.onFinding(makeFinding())).toBe(true);
    // Same type+endpoint+param, different confidence: still a dup.
    const second = w.onFinding(makeFinding({ confidence: 0.5, severity: 'low' }));
    expect(second).toBe(false);
    expect(core.getState().findings).toHaveLength(1);
    w.unsubscribe();
  });

  it('treats a different param as a new finding', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    expect(w.onFinding(makeFinding({ param: 'query' }))).toBe(true);
    expect(w.onFinding(makeFinding({ param: 'name' }))).toBe(true);
    expect(core.getState().findings).toHaveLength(2);
    w.unsubscribe();
  });

  it('forwards finding-deduped events to onFindingDeduped listener', () => {
    const core = makeCore();
    const deduped: Array<{ type: string; existingId: string }> = [];
    const w = wireHuntCore({
      core,
      onFindingDeduped: (f, existingId) => deduped.push({ type: f.type, existingId }),
    });
    const f = makeFinding();
    w.onFinding(f);
    w.onFinding(makeFinding()); // dup
    expect(deduped).toHaveLength(1);
    expect(deduped[0].type).toBe('reflected-xss');
    expect(typeof deduped[0].existingId).toBe('string');
    w.unsubscribe();
  });
});

describe('wireHuntCore.onPrimitive', () => {
  it('records a PrimitiveCall with id, agentId, primitive, args, startedAt, endedAt, result', () => {
    const core = makeCore();
    const w = wireHuntCore({ core, agentId: 'agent-7' });
    const calls: any[] = [];
    core.on((e) => e.type === 'primitive-call' && calls.push(e.call));
    w.onPrimitive('httpRequest', { url: 'https://x.com' }, { ok: true, durationMs: 42 });
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(typeof c.id).toBe('string');
    expect(c.agentId).toBe('agent-7');
    expect(c.primitive).toBe('httpRequest');
    expect(c.args).toEqual({ url: 'https://x.com' });
    expect(typeof c.startedAt).toBe('number');
    expect(typeof c.endedAt).toBe('number');
    expect(c.endedAt).toBeGreaterThanOrEqual(c.startedAt);
    expect(c.result).toEqual({ ok: true });
    expect(c.error).toBeUndefined();
    w.unsubscribe();
  });

  it('attaches the error string when ok=false', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    const calls: any[] = [];
    core.on((e) => e.type === 'primitive-call' && calls.push(e.call));
    w.onPrimitive('craftPayload', { kind: 'xss' }, { ok: false, error: 'no sink found', durationMs: 5 });
    expect(calls[0].result).toEqual({ ok: false });
    expect(calls[0].error).toBe('no sink found');
    w.unsubscribe();
  });

  it('stamps startedAt from the duration so endedAt === now', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    const calls: any[] = [];
    core.on((e) => e.type === 'primitive-call' && calls.push(e.call));
    const before = Date.now();
    w.onPrimitive('x', {}, { ok: true, durationMs: 100 });
    const after = Date.now();
    const c = calls[0];
    expect(c.endedAt).toBeGreaterThanOrEqual(before);
    expect(c.endedAt).toBeLessThanOrEqual(after);
    expect(c.endedAt - c.startedAt).toBeGreaterThanOrEqual(95);
    w.unsubscribe();
  });

  it('increments core.state.primitiveCallCount', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    w.onPrimitive('a', {}, { ok: true, durationMs: 1 });
    w.onPrimitive('b', {}, { ok: true, durationMs: 1 });
    w.onPrimitive('c', {}, { ok: true, durationMs: 1 });
    expect(core.getState().primitiveCallCount).toBe(3);
    w.unsubscribe();
  });
});

describe('wireHuntCore.onChat / onLog / onOOB / onScreenshot', () => {
  it('onChat forwards role + text', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    const seen: any[] = [];
    core.on((e) => e.type === 'chat-message' && seen.push(e.message));
    w.onChat('user', 'attack /api/users/1');
    w.onChat('assistant', 'planning an IDOR probe');
    expect(seen).toEqual([
      { role: 'user', text: 'attack /api/users/1' },
      { role: 'assistant', text: 'planning an IDOR probe' },
    ]);
    w.unsubscribe();
  });

  it('onLog forwards level + text', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    const seen: any[] = [];
    core.on((e) => e.type === 'log' && seen.push(e.log));
    w.onLog('info', 'spider done');
    w.onLog('warn', 'rate limit hit');
    expect(seen).toEqual([
      { level: 'info', text: 'spider done' },
      { level: 'warn', text: 'rate limit hit' },
    ]);
    w.unsubscribe();
  });

  it('onOOB forwards the callback and increments the counter', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    const seen: any[] = [];
    core.on((e) => e.type === 'oob-callback' && seen.push(e.callback));
    w.onOOB({ kind: 'ssrf', url: 'http://oast/x', requestId: 'r1' });
    w.onOOB({ kind: 'blind-xss', url: 'http://oast/y', requestId: 'r2' });
    expect(seen).toHaveLength(2);
    expect(core.getState().oobCallbackCount).toBe(2);
    w.unsubscribe();
  });

  it('onScreenshot forwards the screenshot and increments the counter', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    const seen: any[] = [];
    core.on((e) => e.type === 'screenshot' && seen.push(e.screenshot));
    w.onScreenshot({ path: '/tmp/a.png', label: 'level1', width: 1280, height: 720, sizeBytes: 9000 });
    expect(seen).toHaveLength(1);
    expect(seen[0].label).toBe('level1');
    expect(core.getState().screenshotCount).toBe(1);
    w.unsubscribe();
  });
});

describe('wireHuntCore — done event and unsubscribe', () => {
  it('fires onHuntEnd with the reason when core.stop() emits done', () => {
    const core = makeCore();
    const reasons: string[] = [];
    const w = wireHuntCore({ core, onHuntEnd: (r) => reasons.push(r) });
    core.start();
    core.stop('user-quit');
    expect(reasons).toEqual(['user-quit']);
    w.unsubscribe();
  });

  it('unsubscribe detaches the core subscription (no further events fire)', () => {
    const core = makeCore();
    const reasons: string[] = [];
    const w = wireHuntCore({ core, onHuntEnd: (r) => reasons.push(r) });
    core.start();
    w.unsubscribe();
    core.stop('user-quit');
    expect(reasons).toEqual([]);
  });

  it('unsubscribe is idempotent (calling twice does not throw)', () => {
    const core = makeCore();
    const w = wireHuntCore({ core });
    w.unsubscribe();
    expect(() => w.unsubscribe()).not.toThrow();
  });

  it('onFinding after unsubscribe still forwards (the closure stays valid)', () => {
    // The unsubscribe() only detaches the listener. The transform
    // functions (onFinding/onPrimitive) still call into the core
    // because they hold their own reference to `core`. Useful if a
    // caller wants to suppress notifications but keep recording.
    const core = makeCore();
    const w = wireHuntCore({ core });
    w.unsubscribe();
    expect(w.onFinding(makeFinding())).toBe(true);
    expect(core.getState().findings).toHaveLength(1);
  });
});

describe('wireHuntCore — integration with a running core', () => {
  it('composes with a started core (mirrors runHunt: start, then wire)', () => {
    const core = makeCore();
    core.start();
    expect(core.getState().phase).toBe('observing');
    const w = wireHuntCore({ core });
    w.onFinding(makeFinding());
    w.onPrimitive('httpRequest', { url: 'https://x.com' }, { ok: true, durationMs: 10 });
    expect(core.getState().findings).toHaveLength(1);
    expect(core.getState().primitiveCallCount).toBe(1);
    const summary = core.stop('user-quit');
    expect(summary.findingsCount).toBe(1);
    expect(summary.totalPrimitiveCalls).toBe(1);
    expect(core.getState().phase).toBe('done');
    w.unsubscribe();
  });

  it('records a finding in a HuntCore that was started before wireHuntCore was called', () => {
    // runHunt does this: core.start() at the top of [3/5], wireHuntCore
    // a few lines later, then orchestrator pushes findings. Make sure
    // the order is fine.
    const core = makeCore();
    core.start();
    const w = wireHuntCore({ core });
    const f1 = makeFinding({ type: 'sqli', param: 'id' });
    const f2 = makeFinding({ type: 'xss', param: 'q' });
    expect(w.onFinding(f1)).toBe(true);
    expect(w.onFinding(f2)).toBe(true);
    expect(core.getState().findings.map((f) => f.type).sort()).toEqual(['sqli', 'xss']);
    w.unsubscribe();
    core.stop('user-quit');
  });
});
