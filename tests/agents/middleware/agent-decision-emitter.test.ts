import { describe, it, expect } from 'vitest';
import { AgentDecisionEmitter, NoopAgentDecisionEmitter } from '../../../src/agents/middleware/agent-decision-emitter';
import { DecisionCommenter } from '../../../src/explorer/decision-commenter';
import { FakeLLM, asBaseChatModel } from '../../helpers/fake-llm';

describe('AgentDecisionEmitter', () => {
  it('emits structured event with redaction', async () => {
    const captured: unknown[] = [];
    const sink = (e: unknown) => captured.push(e);
    const commenter = new DecisionCommenter();
    const e = new AgentDecisionEmitter({ sink, commenter, agentName: 'worker-1' });
    const ev = await e.emitToolCall('http_request', { url: '/api/x', password: 'supersecret', method: 'POST' });
    expect(ev.tool).toBe('http_request');
    expect(ev.args['password']).toBe('••••••');
    expect(ev.args['url']).toBe('/api/x');
    expect(ev.args['method']).toBe('POST');
    expect(ev.id).toMatch(/^dec-/);
    expect(captured.length).toBe(1);
  });

  it('truncates long string args', async () => {
    const sink = () => {};
    const commenter = new DecisionCommenter();
    const e = new AgentDecisionEmitter({ sink, commenter });
    const long = 'X'.repeat(500);
    const ev = await e.emitToolCall('http_request', { url: long });
    expect((ev.args['url'] as string).length).toBeLessThanOrEqual(201);
    expect(ev.args['url']).toContain('…');
  });

  it('uses LLM for decision comments when available', async () => {
    const sink = () => {};
    const llm = asBaseChatModel(new FakeLLM(['Tested IDOR by varying numeric id parameter']));
    const commenter = new DecisionCommenter(llm);
    const e = new AgentDecisionEmitter({ sink, commenter });
    const ev = await e.emitToolCall('http_request', { url: '/api/users/1' }, 'Testing IDOR');
    expect(ev.decision).toContain('IDOR');
    expect(ev.source).toBe('llm');
  });

  it('falls back to argument hint when LLM unavailable', async () => {
    const sink = () => {};
    const commenter = new DecisionCommenter();
    const e = new AgentDecisionEmitter({ sink, commenter });
    const ev = await e.emitToolCall('http_request', { url: '/api/users/1' }, 'Testing IDOR');
    expect(ev.decision).toContain('Worker');
  });

  it('emits reasoning events with no tool', async () => {
    const captured: unknown[] = [];
    const sink = (e: unknown) => captured.push(e);
    const commenter = new DecisionCommenter();
    const e = new AgentDecisionEmitter({ sink, commenter });
    const ev = await e.emitReasoning('Target has 12 endpoints, 3 forms, and 2 auth flows', ['XSS on /search', 'IDOR on /api/users/:id']);
    expect(ev.tool).toBe('reasoning');
    expect(ev.decision).toBeTruthy();
  });

  it('disable() prevents sink calls but still returns event', async () => {
    const captured: unknown[] = [];
    const sink = (e: unknown) => captured.push(e);
    const commenter = new DecisionCommenter();
    const e = new AgentDecisionEmitter({ sink, commenter });
    e.disable();
    await e.emitToolCall('foo', { x: 1 });
    expect(captured.length).toBe(0);
    expect(e.isEnabled()).toBe(false);
  });

  it('enable() re-enables after disable', () => {
    const sink = () => {};
    const e = new AgentDecisionEmitter({ sink, commenter: new DecisionCommenter() });
    e.disable();
    e.enable();
    expect(e.isEnabled()).toBe(true);
  });

  it('getRisk() is called for each event', async () => {
    let currentRisk = 0;
    const sink = () => {};
    const e = new AgentDecisionEmitter({
      sink,
      commenter: new DecisionCommenter(),
      getRisk: () => currentRisk,
    });
    currentRisk = 5.0;
    const ev = await e.emitToolCall('a', {});
    expect(ev.risk).toBe(5.0);
    currentRisk = 7.5;
    const ev2 = await e.emitToolCall('a', {});
    expect(ev2.risk).toBe(7.5);
  });

  it('default getRisk returns 0', async () => {
    const sink = () => {};
    const e = new AgentDecisionEmitter({ sink, commenter: new DecisionCommenter() });
    const ev = await e.emitToolCall('a', {});
    expect(ev.risk).toBe(0);
  });

  it('redacts multiple sensitive keys', async () => {
    const sink = () => {};
    const e = new AgentDecisionEmitter({ sink, commenter: new DecisionCommenter() });
    const ev = await e.emitToolCall('a', {
      password: 'p',
      token: 't',
      secret: 's',
      apiKey: 'k',
      authorization: 'auth',
      cookie: 'c',
      sessionId: 'sess',
      normal: 'visible',
    });
    expect(ev.args['password']).toBe('••••••');
    expect(ev.args['token']).toBe('••••••');
    expect(ev.args['secret']).toBe('••••••');
    expect(ev.args['apiKey']).toBe('••••••');
    expect(ev.args['authorization']).toBe('••••••');
    expect(ev.args['cookie']).toBe('••••••');
    expect(ev.args['sessionId']).toBe('••••••');
    expect(ev.args['normal']).toBe('visible');
  });

  it('unique IDs across calls', async () => {
    const e = new AgentDecisionEmitter({ sink: () => {}, commenter: new DecisionCommenter() });
    const a = await e.emitToolCall('a', {});
    const b = await e.emitToolCall('a', {});
    const c = await e.emitReasoning('x');
    expect(a.id).not.toBe(b.id);
    expect(b.id).not.toBe(c.id);
  });

  it('NoopAgentDecisionEmitter does nothing', async () => {
    const e = new NoopAgentDecisionEmitter();
    const ev = await e.emitToolCall('a', { url: '/x' });
    expect(ev.id).toBe('noop');
    expect(ev.tool).toBe('');
    const ev2 = await e.emitReasoning('x');
    expect(ev2.id).toBe('noop');
  });

  it('handles non-string non-object args gracefully', async () => {
    const e = new AgentDecisionEmitter({ sink: () => {}, commenter: new DecisionCommenter() });
    const ev = await e.emitToolCall('a', { x: 42, y: true, z: null });
    expect(ev.args['x']).toBe(42);
    expect(ev.args['y']).toBe(true);
    expect(ev.args['z']).toBe(null);
  });
});
