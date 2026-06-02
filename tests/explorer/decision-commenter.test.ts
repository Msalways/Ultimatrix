import { describe, it, expect } from 'vitest';
import {
  DecisionCommenter,
  fallbackComment,
  generateDecisionComment,
  type DecisionContext,
} from '../../src/explorer/decision-commenter';
import { FakeLLM, asBaseChatModel } from '../helpers/fake-llm';

function makeCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    agent: 'strategist',
    action: 'dispatched IDOR specialist',
    target: '/api/users/123',
    reasoning: 'Numeric ID parameter present',
    priorFindings: 2,
    currentRisk: 4.5,
    hypotheses: ['IDOR on /api/users/:id'],
    ...overrides,
  };
}

describe('DecisionCommenter', () => {
  it('fallback comment includes agent role and target', () => {
    const c = fallbackComment(makeCtx());
    expect(c.source).toBe('fallback');
    expect(c.text).toContain('Orchestrator');
    expect(c.text).toContain('/api/users/123');
  });

  it('truncates long targets in fallback', () => {
    const longTarget = '/api/' + 'segment/'.repeat(20) + 'id';
    const c = fallbackComment(makeCtx({ target: longTarget }));
    expect(c.text.length).toBeLessThan(160);
    expect(c.text).toContain('…');
  });

  it('falls back when LLM is null', async () => {
    const c = await generateDecisionComment(null, makeCtx());
    expect(c.source).toBe('fallback');
  });

  it('uses LLM response when available', async () => {
    const llm = asBaseChatModel(new FakeLLM(['IDOR specialist dispatched because numeric id parameter is reachable']));
    const c = await generateDecisionComment(llm, makeCtx());
    expect(c.source).toBe('llm');
    expect(c.text).toContain('IDOR');
    expect(c.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('truncates LLM response to 200 chars', async () => {
    const long = 'A'.repeat(500);
    const llm = asBaseChatModel(new FakeLLM([long]));
    const c = await generateDecisionComment(llm, makeCtx());
    expect(c.text.length).toBeLessThanOrEqual(200);
  });

  it('takes first line of multi-line LLM response', async () => {
    const llm = asBaseChatModel(new FakeLLM(['First line reasoning\nSecond line junk\nThird line']));
    const c = await generateDecisionComment(llm, makeCtx());
    expect(c.text).toBe('First line reasoning');
  });

  it('falls back on LLM error', async () => {
    const fake = new FakeLLM([]);
    fake.invoke = async () => { throw new Error('timeout'); };
    const llm = asBaseChatModel(fake);
    const c = await generateDecisionComment(llm, makeCtx());
    expect(c.source).toBe('fallback');
  });

  it('falls back on empty LLM response', async () => {
    const llm = asBaseChatModel(new FakeLLM(['']));
    const c = await generateDecisionComment(llm, makeCtx());
    expect(c.source).toBe('fallback');
  });

  it('caches results', async () => {
    const llm = asBaseChatModel(new FakeLLM(['Response A']));
    const d = new DecisionCommenter(llm);
    const ctx = makeCtx();
    const a = await d.comment(ctx);
    const b = await d.comment(ctx);
    expect(a).toEqual(b);
    expect(llm.callCount).toBe(1);
  });

  it('different contexts get different responses', async () => {
    const llm = asBaseChatModel(new FakeLLM(['XSS', 'IDOR']));
    const d = new DecisionCommenter(llm);
    const r1 = await d.comment(makeCtx({ action: 'a1' }));
    const r2 = await d.comment(makeCtx({ action: 'a2' }));
    expect(r1.text).toBe('XSS');
    expect(r2.text).toBe('IDOR');
  });

  it('clearCache forces re-invocation', async () => {
    const llm = asBaseChatModel(new FakeLLM(['Cached', 'Fresh']));
    const d = new DecisionCommenter(llm);
    const ctx = makeCtx();
    await d.comment(ctx);
    d.clearCache();
    await d.comment(ctx);
    expect(llm.callCount).toBe(2);
  });

  it('handles missing optional fields', async () => {
    const c = fallbackComment({ agent: 'worker', action: 'probed', target: '' });
    expect(c.text).not.toContain('on ');
    expect(c.text).toContain('Worker');
  });

  it('all three agent roles have fallback text', () => {
    for (const agent of ['strategist', 'worker', 'specialist'] as const) {
      const c = fallbackComment({ agent, action: 'x', target: '/a' });
      expect(c.text.length).toBeGreaterThan(10);
    }
  });
});
