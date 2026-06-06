// tests/agents/composer.test.ts
//
// Composer.run() now dispatches to the ReAct agent loop. The LLM is the
// system — it returns {thought, tool, args} JSON per turn. The Composer
// surfaces trace events through onLog. These tests verify the wiring.
import { describe, it, expect, vi } from 'vitest';
import { Composer } from '../../src/agents/composer';
import { LLMClient } from '../../src/llm/client';
import type { AppModelEndpoint } from '../../src/core/app-model';
import type { PrimitiveContext } from '../../src/primitives/types';

function mkLLM(responses: Array<{ text: string; json?: unknown }>): LLMClient {
  const c = new LLMClient({ provider: 'mock' });
  c.call = vi.fn(async () => {
    const r = responses.shift() ?? { text: JSON.stringify({ tool: 'giveUp', thought: 'no more responses', args: {} }) };
    const text = r.text;
    const json = r.json ?? safeJson(text);
    return { text, json, provider: 'mock' as const, model: 'mock', durationMs: 0 };
  });
  c.isReal = () => false;
  return c;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function mkTarget(over: Partial<AppModelEndpoint> = {}): AppModelEndpoint {
  return {
    path: '/api/users/1',
    method: 'GET',
    params: [{ name: 'id', type: 'string', required: true }],
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

describe('Composer (agent loop)', () => {
  it('terminates cleanly when LLM gives up', async () => {
    const llm = mkLLM([
      { text: JSON.stringify({ thought: 'no vulns visible', tool: 'giveUp', args: {} }) },
    ]);
    const c = new Composer({ llm });
    const r = await c.run(mkTarget(), mkCtx());
    expect(r.findings.length).toBe(0);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.llmWasReal).toBe(false);
  });

  it('emits agent-turn events for each LLM call', async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const llm = mkLLM([
      { text: JSON.stringify({ thought: 'scanning params', tool: 'parseResponse', args: { html: '<a href="/x">x</a>' } }) },
      { text: JSON.stringify({ thought: 'done', tool: 'giveUp', args: {} }) },
    ]);
    const c = new Composer({ llm, onLog: (e) => events.push(e) });
    await c.run(mkTarget(), mkCtx());
    const turns = events.filter((e) => e.type === 'agent-turn');
    expect(turns.length).toBe(2);
    expect(turns[0].tool).toBe('parseResponse');
    expect(turns[0].thought).toBe('scanning params');
    expect(turns[0].ok).toBe(true);
    expect(typeof turns[0].durationMs).toBe('number');
  });

  it('emits agent-trace summary at end', async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const llm = mkLLM([
      { text: JSON.stringify({ thought: 't', tool: 'giveUp', args: {} }) },
    ]);
    const c = new Composer({ llm, onLog: (e) => events.push(e) });
    await c.run(mkTarget(), mkCtx());
    const trace = events.find((e) => e.type === 'agent-trace');
    expect(trace).toBeDefined();
    expect(trace?.turns).toBe(1);
    expect(trace?.outcome).toBe('clean');
  });

  it('emits finding event when LLM calls writeFinding with real evidence', async () => {
    const triageResponse = { real: true, reasoning: 'evidence is concrete' };
    const llm = new LLMClient({ provider: 'mock' });
    let callCount = 0;
    llm.call = vi.fn(async (args: any) => {
      callCount++;
      if (args.label?.startsWith('triage')) {
        return { text: JSON.stringify(triageResponse), json: triageResponse, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      if (callCount === 1) {
        return { text: JSON.stringify({ thought: 'found XSS', tool: 'parseResponse', args: { html: '<script>alert(1)</script>' } }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      if (callCount === 2) {
        return { text: JSON.stringify({ thought: 'recording', tool: 'writeFinding', args: { type: 'xss', endpoint: '/api/users/1', param: 'name', severity: 'high', confidence: 0.9, description: 'reflected script tag' } }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      return { text: JSON.stringify({ thought: 'done', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const c = new Composer({ llm, onLog: (e) => events.push(e) });
    const r = await c.run(mkTarget(), mkCtx());
    expect(r.findings.length).toBe(1);
    const f = events.find((e) => e.type === 'finding');
    expect(f).toBeDefined();
    expect(f?.findingType).toBe('xss');
    expect(f?.severity).toBe('high');
  });

  it('emits sub-agent-spawn and sub-agent-result when LLM spawns an agent', async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    let callCount = 0;
    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async (args: any) => {
      callCount++;
      // 1st call: meta-orchestrator spawns a sub-agent
      if (callCount === 1) {
        return { text: JSON.stringify({
          thought: 'delegating sqli test',
          tool: 'spawnAgent',
          args: { task: 'try SQLi on login form', tools: ['httpRequest', 'compareResponses', 'measureTiming'], maxAttempts: 3, strategy: 'UNION-based' },
        }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      // 2nd call: sub-agent's first turn
      if (callCount === 2) {
        return { text: JSON.stringify({ thought: 'done', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      // 3rd call: meta-orchestrator's second turn — give up
      return { text: JSON.stringify({ thought: 'all done', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const c = new Composer({ llm, onLog: (e) => events.push(e) });
    await c.run(mkTarget(), mkCtx());
    const spawn = events.find((e) => e.type === 'sub-agent-spawn');
    const result = events.find((e) => e.type === 'sub-agent-result');
    expect(spawn).toBeDefined();
    expect(spawn?.task).toBe('try SQLi on login form');
    expect((spawn?.tools as string[]).length).toBe(3);
    expect(spawn?.strategy).toBe('UNION-based');
    expect(result).toBeDefined();
    expect(typeof result?.durationMs).toBe('number');
  });

  it('onLog callback errors do not break the hunt', async () => {
    const llm = mkLLM([
      { text: JSON.stringify({ thought: 't', tool: 'giveUp', args: {} }) },
    ]);
    const c = new Composer({
      llm,
      onLog: () => { throw new Error('UI sink crashed'); },
    });
    // Should NOT throw
    await expect(c.run(mkTarget(), mkCtx())).resolves.toBeDefined();
  });

  it('falls back to giveUp when LLM returns unparseable text', async () => {
    const llm = mkLLM([{ text: 'definitely not json' }]);
    const c = new Composer({ llm });
    const r = await c.run(mkTarget(), mkCtx());
    // Unparseable → agent loop gives up cleanly, no findings
    expect(r.findings.length).toBe(0);
  });

  it('treats writeFinding as free-form — LLM names type/severity', async () => {
    const triageResponse = { real: true, reasoning: 'yes' };
    const llm = new LLMClient({ provider: 'mock' });
    let callCount = 0;
    llm.call = vi.fn(async (args: any) => {
      callCount++;
      if (args.label?.startsWith('triage')) {
        return { text: JSON.stringify(triageResponse), json: triageResponse, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      if (callCount === 1) {
        return { text: JSON.stringify({ thought: 'recording', tool: 'writeFinding', args: { type: 'gpu-buffer-overflow', endpoint: '/x', param: 'mem', severity: 'cosmic', confidence: 0.99 } }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      return { text: JSON.stringify({ thought: 'd', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const c = new Composer({ llm });
    const r = await c.run(mkTarget(), mkCtx());
    expect(r.findings.length).toBe(1);
    // Free-form strings preserved
    expect(r.findings[0].type).toBe('gpu-buffer-overflow');
    expect(r.findings[0].severity).toBe('cosmic');
  });
});
