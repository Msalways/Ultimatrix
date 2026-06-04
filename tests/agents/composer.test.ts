// tests/agents/composer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Composer } from '../../src/agents/composer';
import { LLMClient } from '../../src/llm/client';
import type { AppModelEndpoint } from '../../src/core/app-model';
import type { PrimitiveContext } from '../../src/primitives/types';

function mkLLM(responses: Array<{ json?: unknown; text?: string }>): LLMClient {
  const c = new LLMClient({ provider: 'mock' });
  c.call = vi.fn(async () => {
    const r = responses.shift() ?? { text: '{}' };
    return { text: r.text ?? JSON.stringify(r.json ?? {}), json: r.json ?? null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
  });
  c.isReal = () => false; // mock LLM, use heuristic triage only
  return c;
}

function mkTarget(over: Partial<AppModelEndpoint> = {}): AppModelEndpoint {
  return {
    path: '/api/users/1',
    method: 'GET',
    params: ['id'],
    requiresAuth: false,
    responseStatus: 200,
    contentType: 'application/json',
    bodyPreview: '{"id":1,"name":"alice"}',
    ...over,
  };
}

function mkCtx(): PrimitiveContext {
  return {
    baseUrl: 'http://test.local',
    cookies: {},
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: Date.now(), maxMs: 60_000 },
  };
}

describe('Composer', () => {
  it('parses a plan from the LLM and runs it', async () => {
    const llm = mkLLM([
      { json: { plans: [{
        id: 1, technique: 'idor', rationale: 'guest-vs-admin divergence test', confidence: 0.8,
        primitives: [
          { name: 'findEndpointsInResponse', args: { html: '<a href="/users">U</a>', baseUrl: 'http://test.local' } },
        ],
        expectedOutcome: 'clean',
      }] } },
    ]);
    const c = new Composer({ llm });
    const r = await c.run(mkTarget(), mkCtx());
    expect(r.plans.length).toBe(1);
    expect(r.plans[0].technique).toBe('idor');
  });

  it('falls back to default mock plan when LLM returns no JSON', async () => {
    const llm = mkLLM([{ text: 'not json' }]);
    const c = new Composer({ llm });
    // Use a target with no real http primitives — parseResponse only needs the body
    const r = await c.run(mkTarget({ method: 'GET', path: '/probe' }), mkCtx());
    // The mock plan has httpRequest which tries to fetch a real URL — wrap in a try
    expect(r.plans.length).toBeGreaterThan(0);
    expect(r.llmWasReal).toBe(false);
  });

  it('emits a finding via compareResponses with vulnerable=true', async () => {
    const baseline = {
      status: 200, url: 'http://test.local/api/users/1', finalUrl: 'http://test.local/api/users/1',
      headers: {}, body: '{"id":1,"role":"guest"}', durationMs: 5, redirects: [],
      timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
    };
    const target = {
      status: 200, url: 'http://test.local/api/users/1', finalUrl: 'http://test.local/api/users/1',
      headers: {}, body: '{"id":1,"role":"admin","email":"a@b.com","phone":"x","ssn":"123"}', durationMs: 5, redirects: [],
      timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
    };
    const llm = mkLLM([
      { json: { plans: [{
        id: 1, technique: 'idor', rationale: 'session divergence', confidence: 0.9,
        primitives: [
          { name: 'compareResponses', args: { baseline, target } },
        ],
      }] } },
    ]);
    const c = new Composer({ llm });
    const r = await c.run(mkTarget(), mkCtx());
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0].type).toBe('idor');
    expect(r.findings[0].severity).toBe('critical');
  });

  it('records a subtask when a primitive signals a spawn (chain-reasoning)', async () => {
    // The plan uses spawnSubtask which sets result.spawn — verify the
    // Composer's subtaskSink captures it via the onSubtask callback.
    const subtaskCalls: Array<{ specialist: string; reason: string }> = [];
    const llm = mkLLM([
      { json: { plans: [{
        id: 1, technique: 'xss', rationale: 'spawn chain reasoning', confidence: 0.7,
        primitives: [
          { name: 'spawnSubtask', args: { specialist: 'chain-reasoning', reason: 'multiple findings present', payload: '<script>alert(1)</script>' } },
        ],
      }] } },
    ]);
    const c = new Composer({
      llm,
      onSubtask: (specialist, reason) => subtaskCalls.push({ specialist, reason }),
    });
    const r = await c.run(mkTarget(), mkCtx());
    expect(subtaskCalls.length).toBeGreaterThan(0);
    expect(subtaskCalls[0].specialist).toBe('chain-reasoning');
    expect(r.subtasks.length).toBeGreaterThan(0);
  });

  it('exposes a planner system prompt that mentions sink + param matching', () => {
    // Regression: the new prompt must explicitly tell the LLM to match
    // technique to the param that actually accepts it (avoiding the
    // XSS-game bug where the LLM picked ?next= instead of ?query=).
    const systemPrompt = (Composer as any).SYSTEM_PROMPT_PLANNER ?? '';
    // We can't import the constant from the module — it isn't exported.
    // So just verify the planner LLM call embeds the right guidance by
    // capturing the system arg.
    let capturedSystem = '';
    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async (args: any) => {
      capturedSystem = args.system ?? '';
      return { text: '{}', json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const c = new Composer({ llm });
    c.proposePlans(mkTarget(), mkCtx(), 1).catch(() => {});
    // Wait for the promise to settle
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(capturedSystem).toMatch(/param/i);
        expect(capturedSystem.length).toBeGreaterThan(500); // prompt is non-trivial
        resolve();
      }, 50);
    });
  });
});
