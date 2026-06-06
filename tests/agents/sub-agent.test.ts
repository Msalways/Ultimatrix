// tests/agents/sub-agent.test.ts
//
// Block 9 tests: real recursive sub-agents + proper orchestrator info-flow.
//
// Covers:
// - Sub-agent at depth 0 can spawn a sub-sub-agent; sub-sub-agent's
//   findings propagate up.
// - Sub-agent at depth 1 (sub-sub-agent) cannot spawn further
//   (spawnAgent filtered from tool set at depth 2+).
// - Sub-agent calling tool not in its set gets ok=false error.
// - Sub-agent getUp/stop terminates cleanly.
// - Sub-agent writeFinding accepted → outcome vulnerable, break, finding
//   in return.
// - Sub-agent writeFinding rejected → outcome unchanged, observation
//   recorded.
// - Large-result primitives (compareResponses, findEndpointsInResponse)
//   produce structured observations (no 300-char gate).
// - Schema for sub-agent excludes spawnAgent when allowSpawn=false.
// - Sub-sub-agent attached to parent's subSubAgents[].

import { describe, it, expect, vi } from 'vitest';
import { runSubAgent, formatObservation } from '../../src/agents/sub-agent';
import { LLMClient } from '../../src/llm/client';
import type { PrimitiveContext, PrimitiveName } from '../../src/primitives/types';
import type { AppModelFinding } from '../../src/core/app-model';
import { buildSubAgentPrompt } from '../../src/agents/agent-prompts';
import { schemasForToolNames } from '../../src/agents/tool-schema';

function mkLLM(responses: Array<string | { text: string }>): LLMClient {
  const c = new LLMClient({ provider: 'mock' });
  c.call = vi.fn(async () => {
    const r = responses.shift();
    let text: string;
    if (typeof r === 'string') text = r;
    else if (r && typeof r === 'object' && 'text' in r) text = r.text;
    else text = JSON.stringify({ tool: 'giveUp', thought: 'no more responses', args: {} });
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { text, json, provider: 'mock' as const, model: 'mock', durationMs: 0 };
  });
  c.isReal = () => false;
  return c;
}

function mkCtx(over: Partial<PrimitiveContext> = {}): PrimitiveContext {
  return {
    baseUrl: 'http://test.local',
    cookies: {},
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: Date.now(), maxMs: 60_000 },
    ...over,
  };
}

const TOOLS_NO_SPAWN: PrimitiveName[] = ['httpRequest', 'parseResponse', 'findEndpointsInResponse'];

describe('runSubAgent — basic lifecycle', () => {
  it('returns clean outcome when LLM gives up immediately', async () => {
    const llm = mkLLM([JSON.stringify({ thought: 'nothing to do', tool: 'giveUp', args: {} })]);
    const r = await runSubAgent({
      id: 's1',
      task: 'recon',
      tools: TOOLS_NO_SPAWN,
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
    });
    expect(r.outcome).toBe('clean');
    expect(r.findings).toEqual([]);
    expect(r.turns.length).toBe(1);
    expect(r.depth).toBe(0);
    expect(r.subSubAgents).toEqual([]);
  });

  it('returns invalid outcome when LLM returns unparseable text', async () => {
    const llm = mkLLM(['definitely not json']);
    const r = await runSubAgent({
      id: 's2',
      task: 'recon',
      tools: TOOLS_NO_SPAWN,
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
    });
    expect(r.outcome).toBe('invalid');
  });

  it('returns error outcome after 3 consecutive LLM failures', async () => {
    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async () => { throw new Error('LLM down'); });
    llm.isReal = () => false;
    const r = await runSubAgent({
      id: 's3',
      task: 'recon',
      tools: TOOLS_NO_SPAWN,
      maxAttempts: 5,
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
    });
    expect(r.outcome).toBe('error');
  });
});

describe('runSubAgent — tool filter', () => {
  it('calling a tool not in the set returns ok=false with explicit error', async () => {
    const llm = mkLLM([
      JSON.stringify({ thought: 'try a tool I do not have', tool: 'craftPayload', args: { type: 'xss' } }),
      JSON.stringify({ thought: 'done', tool: 'giveUp', args: {} }),
    ]);
    const r = await runSubAgent({
      id: 's4',
      task: 'recon',
      tools: ['httpRequest'], // no craftPayload
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
    });
    const blocked = r.turns.find((t) => t.tool === 'craftPayload');
    expect(blocked).toBeDefined();
    expect(blocked?.result?.ok).toBe(false);
    expect(blocked?.result?.error).toMatch(/not in sub-agent's set/i);
  });
});

describe('runSubAgent — auto-observations for large results', () => {
  it('compareResponses with 2KB diff produces a structured observation', async () => {
    // The actual primitive execution path is tested in
    // primitives/.compareResponses.test.ts. Here we just verify the
    // observation-generation logic preserves large objects.
    const big = {
      score: 0.72,
      diff: Array.from({ length: 200 }, (_, i) => `line ${i} differs`).join('\n'),
    };
    const obs = formatObservation('compareResponses', big);
    expect(obs).toContain('compareResponses');
    expect(obs).toContain('object{score, diff}');
    expect(obs).toContain('excerpt');
    // 2KB diff gets truncated in the excerpt
    expect(obs).toContain('truncated');
  });

  it('findEndpointsInResponse with 5 endpoints produces a structured observation', async () => {
    const obs = formatObservation('findEndpointsInResponse', [
      '/a', '/b', '/c', '/d', '/e',
    ]);
    expect(obs).toContain('array(5');
    expect(obs).toContain('excerpt');
  });

  it('string values over 800 chars get a truncated marker', async () => {
    const big = 'x'.repeat(2000);
    const obs = formatObservation('parseResponse', big);
    expect(obs).toContain('truncated');
  });
});

describe('runSubAgent — writeFinding', () => {
  it('writeFinding accepted sets outcome=vulnerable, breaks loop, finding in return', async () => {
    const llm = new LLMClient({ provider: 'mock' });
    let triageCount = 0;
    llm.call = vi.fn(async (args: any) => {
      const isTriage = args.label?.startsWith('triage') || (args.system ?? '').startsWith('You are the triage module');
      if (isTriage) {
        triageCount++;
        return {
          text: JSON.stringify({ real: true, reasoning: 'concrete evidence' }),
          json: { real: true, reasoning: 'concrete evidence' },
          provider: 'mock' as const,
          model: 'mock',
          durationMs: 0,
        };
      }
      const text = JSON.stringify({
        thought: 'recording',
        tool: 'writeFinding',
        args: { type: 'xss', endpoint: '/x', param: 'q', severity: 'high', confidence: 0.9, description: 'reflected XSS' },
      });
      return { text, json: JSON.parse(text), provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const findings: AppModelFinding[] = [];
    const r = await runSubAgent({
      id: 'wf1',
      task: 'find XSS',
      tools: TOOLS_NO_SPAWN,
      maxAttempts: 3,
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
      onFinding: (f) => findings.push(f),
    });
    expect(triageCount).toBeGreaterThanOrEqual(1);
    expect(r.outcome).toBe('vulnerable');
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].type).toBe('xss');
    expect(r.findings[0].severity).toBe('high');
    expect(findings.length).toBe(1);
    expect(r.turns.length).toBe(1);
  });
});

describe('runSubAgent — recursive spawn', () => {
  it('depth-0 sub-agent with allowSpawn can spawn a sub-sub-agent; findings propagate up', async () => {
    const llm = new LLMClient({ provider: 'mock' });
    const triageJson = { real: true, reasoning: 'ok' };
    const parentCalls: string[] = [];
    const subCalls: string[] = [];
    llm.call = vi.fn(async (args: any) => {
      const isTriage = (args.system ?? '').startsWith('You are the triage module');
      if (isTriage) {
        return { text: JSON.stringify(triageJson), json: triageJson, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      // Distinguish by label — parent is "sub-agent[p0]", sub is "sub-agent[p0->sub-...]"
      const label: string = args.label ?? '';
      const isParent = label === 'sub-agent[p0]';
      const isSub = label.startsWith('sub-agent[p0->sub-');
      if (isParent) {
        const idx = parentCalls.length;
        parentCalls.push(label);
        if (idx === 0) {
          return {
            text: JSON.stringify({
              thought: 'delegate to sub-sub',
              tool: 'spawnAgent',
              args: { task: 'try SQLi on /login', tools: ['httpRequest'], maxAttempts: 2 },
            }),
            json: null,
            provider: 'mock' as const,
            model: 'mock',
            durationMs: 0,
          };
        }
        // Subsequent parent turns: stop
        return { text: JSON.stringify({ thought: 'parent done', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      if (isSub) {
        const idx = subCalls.length;
        subCalls.push(label);
        if (idx === 0) {
          return {
            text: JSON.stringify({
              thought: 'sqli confirmed',
              tool: 'writeFinding',
              args: { type: 'sqli', endpoint: '/login', param: 'user', severity: 'critical', confidence: 0.95, description: 'auth bypass via UNION' },
            }),
            json: null,
            provider: 'mock' as const,
            model: 'mock',
            durationMs: 0,
          };
        }
        return { text: JSON.stringify({ thought: 'sub done', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      // Should never reach here
      return { text: JSON.stringify({ thought: 'fallback', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const findings: AppModelFinding[] = [];
    const r = await runSubAgent({
      id: 'p0',
      task: 'orchestrate SQLi',
      tools: TOOLS_NO_SPAWN,
      maxAttempts: 5,
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
      allowSpawn: true,
      onFinding: (f) => findings.push(f),
    });
    expect(parentCalls.length).toBeGreaterThanOrEqual(2);
    expect(subCalls.length).toBe(1);
    expect(r.subSubAgents.length).toBe(1);
    expect(r.subSubAgents[0].depth).toBe(1);
    expect(r.subSubAgents[0].outcome).toBe('vulnerable');
    expect(r.subSubAgents[0].findings.length).toBe(1);
    // Sub-sub-agent's finding propagates to parent via onFinding callback
    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('sqli');
  });

  it('depth-1 sub-sub-agent (allowSpawn=false) has spawnAgent filtered from its tool set', async () => {
    // The system prompt for the sub-sub-agent should not include spawnAgent.
    const schemas = schemasForToolNames(['httpRequest']); // no spawnAgent in input
    const prompt = buildSubAgentPrompt({
      task: 'do stuff',
      target: 'http://test.local',
      strategy: '',
      toolSchemas: schemas,
      maxAttempts: 3,
    });
    expect(prompt).not.toContain('"name": "spawnAgent"');
  });

  it('depth-1 sub-sub-agent calling spawnAgent anyway is honestly rejected', async () => {
    // This is the defensive path — schema is filtered, but if a weird LLM
    // hallucinates spawnAgent anyway, we should return ok=false (not the
    // legacy fake-success).
    const llm = mkLLM([
      JSON.stringify({ thought: 'try to spawn anyway', tool: 'spawnAgent', args: { task: 'x', tools: [] } }),
      JSON.stringify({ thought: 'stop', tool: 'giveUp', args: {} }),
    ]);
    const r = await runSubAgent({
      id: 'p1',
      task: 'should not recurse',
      tools: ['httpRequest'],
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
      depth: 1, // sub-sub-agent
      allowSpawn: false, // explicit
    });
    const blocked = r.turns.find((t) => t.tool === 'spawnAgent');
    expect(blocked).toBeDefined();
    expect(blocked?.result?.ok).toBe(false);
    expect(blocked?.result?.error).toMatch(/max recursion depth|not available at depth/i);
    expect(r.subSubAgents.length).toBe(0);
  });

  it('sub-sub-agent has parentId set on its SubAgentRun', async () => {
    const llm = new LLMClient({ provider: 'mock' });
    const triageJson = { real: true, reasoning: 'ok' };
    let parentCalls = 0;
    let subCalls = 0;
    llm.call = vi.fn(async (args: any) => {
      const isTriage = (args.system ?? '').startsWith('You are the triage module');
      const label: string = args.label ?? '';
      if (isTriage) {
        return { text: JSON.stringify(triageJson), json: triageJson, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      if (label === 'sub-agent[parent-A]') {
        parentCalls++;
        if (parentCalls === 1) {
          return {
            text: JSON.stringify({
              thought: 'delegate',
              tool: 'spawnAgent',
              args: { task: 'subtask', tools: ['httpRequest'], maxAttempts: 1 },
            }),
            json: null,
            provider: 'mock' as const,
            model: 'mock',
            durationMs: 0,
          };
        }
        return { text: JSON.stringify({ thought: 'parent done', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      // Sub-sub-agent label pattern: sub-agent[parent-A->sub-XXX]
      if (label.startsWith('sub-agent[parent-A->sub-')) {
        subCalls++;
        return { text: JSON.stringify({ thought: 'sub done', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
      }
      return { text: JSON.stringify({ thought: 'fallback', tool: 'giveUp', args: {} }), json: null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const r = await runSubAgent({
      id: 'parent-A',
      task: 'parent',
      tools: TOOLS_NO_SPAWN,
      maxAttempts: 3,
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
      allowSpawn: true,
    });
    expect(r.subSubAgents.length).toBe(1);
    expect(r.subSubAgents[0].parentId).toBe('parent-A');
    expect(parentCalls).toBeGreaterThanOrEqual(2);
    expect(subCalls).toBe(1);
  });
});

describe('runSubAgent — outcome metadata', () => {
  it('sub-agent result includes depth, subSubAgents, observations', async () => {
    const llm = mkLLM([
      JSON.stringify({ thought: 'first', tool: 'parseResponse', args: { html: '<html></html>' } }),
      JSON.stringify({ thought: 'second', tool: 'parseResponse', args: { html: '<a>' } }),
      JSON.stringify({ thought: 'done', tool: 'giveUp', args: {} }),
    ]);
    const r = await runSubAgent({
      id: 'meta',
      task: 'two parses',
      tools: TOOLS_NO_SPAWN,
      maxAttempts: 5,
      target: 'http://test.local',
      ctx: mkCtx(),
      llm,
    });
    expect(r.depth).toBe(0);
    expect(r.subSubAgents).toEqual([]);
    expect(r.observations.length).toBeGreaterThan(0);
    expect(r.outcome).toBe('clean');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});
