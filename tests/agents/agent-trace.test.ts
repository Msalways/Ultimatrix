// tests/agents/agent-trace.test.ts
//
// Block 9 tests: typed SubAgentRun, structured summarizeTrace.

import { describe, it, expect } from 'vitest';
import { TraceBuilder, summarizeTrace, type SubAgentRun, type AgentTrace } from '../../src/agents/agent-trace';
import type { AppModelFinding } from '../../src/core/app-model';

function mkFinding(over: Partial<AppModelFinding> = {}): AppModelFinding {
  return {
    id: 'f-1',
    type: 'xss',
    endpoint: '/search',
    param: 'q',
    method: 'GET',
    payload: '<script>',
    description: 'reflected XSS in search param',
    severity: 'high',
    confidence: 0.9,
    confirmed: true,
    evidence: [],
    ...over,
  };
}

function mkSubAgent(over: Partial<SubAgentRun> = {}): SubAgentRun {
  return {
    id: 'sub-1',
    task: 'find XSS',
    tools: ['httpRequest', 'evaluateRendered'],
    strategy: 'try common payloads',
    maxAttempts: 5,
    turns: [],
    findings: [],
    observations: [],
    startedAt: Date.now(),
    endedAt: Date.now(),
    durationMs: 100,
    outcome: 'inconclusive',
    depth: 0,
    subSubAgents: [],
    ...over,
  };
}

describe('TraceBuilder', () => {
  it('addFinding takes AppModelFinding (typed)', () => {
    const b = new TraceBuilder();
    const f = mkFinding();
    b.addFinding(f);
    expect(b.current().findings).toEqual([f]);
  });

  it('addMetaTurn assigns level=meta', () => {
    const b = new TraceBuilder();
    b.addMetaTurn({
      turnIndex: 0,
      thought: 'first',
      tool: 'httpRequest',
      args: {},
      durationMs: 10,
      startedAt: 0,
    });
    expect(b.current().metaTurns[0].level).toBe('meta');
  });

  it('addSubAgent stores SubAgentRun', () => {
    const b = new TraceBuilder();
    const s = mkSubAgent();
    b.addSubAgent(s);
    expect(b.current().subAgents).toEqual([s]);
  });

  it('setOutcome updates trace outcome', () => {
    const b = new TraceBuilder();
    b.setOutcome('vulnerable');
    expect(b.current().outcome).toBe('vulnerable');
  });

  it('finalize stamps endedAt + durationMs', () => {
    const b = new TraceBuilder();
    const t = b.finalize();
    expect(t.endedAt).toBeGreaterThan(0);
    expect(t.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('summarizeTrace', () => {
  it('emits a header with counts', () => {
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'clean',
    };
    const s = summarizeTrace(t, 8000);
    expect(s).toMatch(/# Trace so far \(0 meta turns, 0 sub-agents, 0 findings\)/);
  });

  it('renders sub-agent findings (not just a count)', () => {
    const sub = mkSubAgent({
      findings: [
        mkFinding({ id: 'f-a', type: 'xss', endpoint: '/a', severity: 'high' }),
        mkFinding({ id: 'f-b', type: 'sqli', endpoint: '/b', param: 'id', severity: 'critical' }),
        mkFinding({ id: 'f-c', type: 'ssrf', endpoint: '/c', severity: 'medium' }),
      ],
    });
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [sub],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'vulnerable',
    };
    const s = summarizeTrace(t, 8000);
    expect(s).toContain('### Findings (3)');
    expect(s).toContain('xss on GET /a (high');
    expect(s).toContain('sqli on GET /b (critical');
    expect(s).toContain('ssrf on GET /c (medium');
  });

  it('renders sub-agent reasoning trace per turn', () => {
    const sub = mkSubAgent({
      turns: [
        {
          turnIndex: 0,
          thought: 'craft a payload',
          tool: 'craftPayload',
          args: { type: 'xss' },
          result: { ok: true, value: '<script>alert(1)</script>', durationMs: 5 },
          durationMs: 5,
          startedAt: 0,
          level: 'sub-agent',
        },
        {
          turnIndex: 1,
          thought: 'send the payload',
          tool: 'httpRequest',
          args: {},
          result: { ok: true, value: '200 OK', durationMs: 50 },
          durationMs: 50,
          startedAt: 0,
          level: 'sub-agent',
        },
      ],
    });
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [sub],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'clean',
    };
    const s = summarizeTrace(t, 8000);
    expect(s).toContain('### Reasoning trace');
    expect(s).toContain('turn 1: craft a payload → craftPayload');
    expect(s).toContain('turn 2: send the payload → httpRequest');
  });

  it('renders sub-agent observations (first 30)', () => {
    const sub = mkSubAgent({
      observations: Array.from({ length: 50 }, (_, i) => `obs-${i}: a real observation`),
    });
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [sub],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'clean',
    };
    const s = summarizeTrace(t, 8000);
    expect(s).toContain('### Observations (50)');
    expect(s).toContain('obs-0: a real observation');
    expect(s).toContain('obs-29: a real observation');
    expect(s).toMatch(/\(20 more\)/);
  });

  it('truncates at maxChars with a marker', () => {
    const sub = mkSubAgent({
      task: 'A'.repeat(200),
      findings: Array.from({ length: 20 }, (_, i) => mkFinding({ id: `f-${i}`, description: 'B'.repeat(200) })),
    });
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [sub],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'vulnerable',
    };
    const s = summarizeTrace(t, 500);
    expect(s.length).toBeLessThanOrEqual(800); // marker adds some
    expect(s).toMatch(/truncated \d+ chars\)/);
  });

  it('default cap is 8000 chars', () => {
    // Just verify it accepts a default-arg call and doesn't throw.
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [mkSubAgent()],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'clean',
    };
    expect(() => summarizeTrace(t)).not.toThrow();
  });

  it('recurses into sub-sub-agents', () => {
    const subSub = mkSubAgent({
      id: 'sub-sub-1',
      task: 'subtask',
      depth: 1,
      parentId: 'sub-1',
      findings: [mkFinding({ id: 'f-deep', type: 'ssrf', endpoint: '/deep' })],
    });
    const sub = mkSubAgent({
      id: 'sub-1',
      subSubAgents: [subSub],
    });
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [sub],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'vulnerable',
    };
    const s = summarizeTrace(t, 8000);
    expect(s).toContain('## Sub-sub-agent: subtask');
    expect(s).toContain('ssrf on GET /deep');
    expect(s).toContain('Sub-sub-agents: 1');
  });

  it('renders observations cap-3 with "(N more)" marker', () => {
    const sub = mkSubAgent({
      observations: Array.from({ length: 35 }, (_, i) => `obs-${i}`),
    });
    const t: AgentTrace = {
      metaTurns: [],
      subAgents: [sub],
      findings: [],
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      outcome: 'clean',
    };
    const s = summarizeTrace(t, 8000);
    expect(s).toContain('…(5 more)');
  });
});
