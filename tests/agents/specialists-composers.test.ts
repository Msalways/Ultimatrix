// tests/agents/specialists-composers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runChainReasoning } from '../../src/agents/specialists-composers/chain-reasoning';
import { LLMClient } from '../../src/llm/client';
import type { AppModelFinding } from '../../src/core/app-model';

function mkLLM(responses: Array<{ json?: unknown }>): LLMClient {
  const c = new LLMClient({ provider: 'mock' });
  c.call = vi.fn(async () => {
    const r = responses.shift() ?? { json: {} };
    return { text: JSON.stringify(r.json), json: r.json, provider: 'mock' as const, model: 'mock', durationMs: 0 };
  });
  c.isReal = () => true;
  return c;
}

describe('chain-reasoning specialist', () => {
  it('returns no chains when no findings', async () => {
    const llm = mkLLM([{ json: { chains: [] } }]);
    const r = await runChainReasoning({ findings: [], target: 'http://test.local', llm });
    expect(r.chains).toEqual([]);
  });

  it('parses LLM chain output into AttackChain objects', async () => {
    const llm = mkLLM([{ json: { chains: [{
      name: 'account-takeover',
      severity: 'critical',
      narrative: 'XSS steals session, then IDOR escalates',
      impact: 'full account takeover',
      steps: [
        { findingType: 'xss', endpoint: '/search', description: 'steal session' },
        { findingType: 'idor', endpoint: '/api/users/{id}', description: 'escalate' },
      ],
    }] } }]);
    const findings: AppModelFinding[] = [
      { type: 'xss', endpoint: '/search', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
      { type: 'idor', endpoint: '/api/users/{id}', param: 'id', method: 'GET', severity: 'critical', confidence: 0.85, confirmed: true, evidence: [] },
    ];
    const r = await runChainReasoning({ findings, target: 'http://test.local', llm });
    expect(r.chains.length).toBe(1);
    expect(r.chains[0].name).toBe('account-takeover');
    expect(r.chains[0].severity).toBe('critical');
    expect(r.chains[0].steps.length).toBe(2);
    expect(r.chains[0].narrative).toContain('XSS');
  });

  it('returns empty chain list on LLM failure', async () => {
    const llm = mkLLM([{ json: null }]);
    const r = await runChainReasoning({
      findings: [{ type: 'xss', endpoint: '/x', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] }],
      target: 'http://test.local', llm,
    });
    expect(r.chains).toEqual([]);
  });
});
