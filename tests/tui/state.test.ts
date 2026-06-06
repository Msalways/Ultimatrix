// tests/tui/state.test.ts
import { describe, it, expect } from 'vitest';
import { makeInitialState, reduce, eventToActions, formatStatusLine, formatStepLine, formatFindingLine } from '../../src/tui/state';
import type { HuntEvent } from '../../src/hunt/events';

describe('TUI state', () => {
  it('initial state has zero counts', () => {
    const s = makeInitialState();
    expect(s.status.findingsCount).toBe(0);
    expect(s.status.cost).toBe(0);
    expect(s.activity).toEqual([]);
  });

  it('reducer handles phase event', () => {
    const s = reduce(makeInitialState(), { type: 'phase', phase: 'attacking' });
    expect(s.status.phase).toBe('attacking');
  });

  it('reducer appends activity and trims at 500', () => {
    let s = makeInitialState();
    for (let i = 0; i < 510; i++) {
      s = reduce(s, { type: 'activity', line: { id: String(i), text: `line ${i}`, level: 'info', timestamp: i } });
    }
    expect(s.activity.length).toBe(500);
    expect(s.activity[0].id).toBe('10');
  });

  it('reducer dedupes findings by id', () => {
    let s = makeInitialState();
    s = reduce(s, { type: 'finding', finding: { id: 'f1', type: 'xss', severity: 'high', endpoint: 'a', confidence: 'h', observedAt: 0 } });
    s = reduce(s, { type: 'finding', finding: { id: 'f1', type: 'xss', severity: 'high', endpoint: 'a', confidence: 'h', observedAt: 0 } });
    expect(s.findings.length).toBe(1);
  });

  it('reducer handles resize', () => {
    const s = reduce(makeInitialState(), { type: 'resize', width: 200, height: 60 });
    expect(s.width).toBe(200);
  });

  it('eventToActions converts phase', () => {
    const actions = eventToActions({ type: 'phase', phase: 'observing' });
    expect(actions).toEqual([{ type: 'phase', phase: 'observing' }]);
  });

  it('eventToActions converts finding to FindingView', () => {
    const ev: HuntEvent = {
      type: 'finding',
      finding: {
        id: 'f1', type: 'reflected-xss', endpoint: '/search', param: 'q', severity: 'high', confidence: 'high',
        evidence: {}, confirmed: true,
      },
    };
    const actions = eventToActions(ev);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'finding' });
  });

  it('eventToActions converts primitive-call to activity', () => {
    const ev: HuntEvent = {
      type: 'primitive-call',
      call: { id: 'p1', agentId: 'a1', primitive: 'httpRequest', args: { method: 'GET' }, startedAt: 0 },
    };
    const actions = eventToActions(ev);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('activity');
  });

  it('eventToActions converts llm-token to streaming', () => {
    const ev: HuntEvent = { type: 'llm-token', token: { source: 'composer', text: 'hello', done: false } };
    const actions = eventToActions(ev);
    expect(actions[0]).toMatchObject({ type: 'llm-token', source: 'composer', text: 'hello', done: false });
  });

  it('eventToActions emits final empty token on done', () => {
    const ev: HuntEvent = { type: 'llm-token', token: { source: 'composer', text: '', done: true } };
    const actions = eventToActions(ev);
    expect(actions).toEqual([{ type: 'llm-token', source: 'composer', text: '', done: true }]);
  });

  it('eventToActions converts screenshot to activity', () => {
    const ev: HuntEvent = { type: 'screenshot', screenshot: { path: '/tmp/x.png', label: 'finding: xss', width: 800, height: 600, sizeBytes: 12345 } };
    const actions = eventToActions(ev);
    expect(actions[0].type).toBe('activity');
  });

  it('eventToActions converts oob-callback to warn activity', () => {
    const ev: HuntEvent = { type: 'oob-callback', callback: { url: 'http://x', source: 'blind-xss', bodyPreview: '', headers: {}, receivedAt: 0 } };
    const actions = eventToActions(ev);
    expect(actions[0]).toMatchObject({ type: 'activity', line: { level: 'warn' } });
  });

  it('formatStatusLine shows time and cost', () => {
    const s = makeInitialState();
    s.status.elapsedSeconds = 65;
    s.status.cost = 1.23;
    const line = formatStatusLine(s.status);
    expect(line).toContain('01:05');
    expect(line).toContain('$1.23');
  });

  it('formatStepLine handles navigate', () => {
    const line = formatStepLine({ id: '1', type: 'navigate', timestamp: 0, url: 'x', tabId: 't', sessionId: 's', data: { url: 'https://x', method: 'hard' }, evidenceRefs: [] });
    expect(line).toContain('https://x');
  });

  it('formatStepLine masks password fills', () => {
    const line = formatStepLine({ id: '1', type: 'fill', timestamp: 0, url: 'x', tabId: 't', sessionId: 's', data: { selector: '#p', value: 'secret', isPassword: true }, evidenceRefs: [] });
    expect(line).toContain('password');
  });

  it('formatFindingLine shows severity badge', () => {
    const line = formatFindingLine({ id: 'f1', type: 'xss', severity: 'high', endpoint: '/s', param: 'q', confidence: 'h', observedAt: 0 });
    expect(line).toContain('HIGH');
    expect(line).toContain('xss');
  });
});
