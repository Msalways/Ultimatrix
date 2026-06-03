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
});
