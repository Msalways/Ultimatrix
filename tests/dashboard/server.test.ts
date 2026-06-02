/**
 * tests/dashboard/server.test.ts
 */

import { describe, it, expect } from 'vitest';
import { agentDecisionToEvent, sessionSwitchToEvent, sessionDiffToEvent } from '../../src/dashboard/server';
import type { AgentDecision } from '../../src/agents/middleware/agent-decision-emitter';
import type { SessionMeta } from '../../src/core/session-pool';

describe('Dashboard event helpers', () => {
  it('agentDecisionToEvent produces type=agent_decision', () => {
    const d: AgentDecision = {
      id: 'dec-1', timestamp: '2026-06-01T00:00:00Z', agent: 'worker', tool: 'http_request',
      args: { url: 'https://x.com' }, decision: 'sending test request', risk: 1, source: 'llm',
    };
    const ev = agentDecisionToEvent(d);
    expect(ev.type).toBe('agent_decision');
    expect(ev.data.id).toBe('dec-1');
  });

  it('sessionSwitchToEvent captures session metadata', () => {
    const meta: SessionMeta = { id: 'user-a', label: 'user-a', role: 'user', createdAt: 0, lastActivityAt: 0, lastUrl: '', cookiesCount: 0, authenticated: true };
    const ev = sessionSwitchToEvent(meta);
    expect(ev.type).toBe('session_switch');
    expect(ev.data.sessionId).toBe('user-a');
    expect(ev.data.role).toBe('user');
    expect(ev.data.authenticated).toBe(true);
  });

  it('sessionDiffToEvent captures diff result', () => {
    const ev = sessionDiffToEvent({
      url: 'https://x.com/api/1',
      sessionA: 'user-a',
      sessionB: 'user-b',
      leakDetected: true,
      notes: ['Different bodies with matching 200'],
    });
    expect(ev.type).toBe('session_diff');
    expect(ev.data.leakDetected).toBe(true);
    expect(ev.data.notes).toContain('Different bodies with matching 200');
  });
});
