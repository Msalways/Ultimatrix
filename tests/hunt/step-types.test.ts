// tests/hunt/step-types.test.ts
import { describe, it, expect } from 'vitest';
import type { BehavioralStep, BehavioralStepType } from '../../src/hunt/recorder/step-types';

const ALL_TYPES: BehavioralStepType[] = [
  'navigate', 'click', 'fill', 'request', 'response',
  'redirect', 'notification', 'console', 'storage',
  'mutation', 'error', 'state', 'wait', 'screenshot', 'evaluate',
];

describe('BehavioralStep types', () => {
  it('has 15 step types', () => {
    expect(ALL_TYPES.length).toBe(15);
  });

  it('ALL_TYPES is exhaustive', () => {
    const seen = new Set(ALL_TYPES);
    expect(seen.size).toBe(15);
  });

  it('every step carries an id, timestamp, url, tabId, sessionId, evidenceRefs', () => {
    const step: BehavioralStep = {
      id: 'abc',
      type: 'navigate',
      timestamp: 0,
      url: 'https://x',
      tabId: 't1',
      sessionId: 's1',
      data: { url: 'https://x', method: 'hard' },
      evidenceRefs: [],
    };
    expect(step.id).toBe('abc');
    expect(step.url).toBe('https://x');
    expect(step.evidenceRefs).toEqual([]);
  });

  it('navigate payload shape', () => {
    const s: BehavioralStep = {
      id: '1', type: 'navigate', timestamp: 0, url: 'x', tabId: 't', sessionId: 's',
      data: { url: 'x', method: 'spa', referrer: 'y' },
      evidenceRefs: [],
    };
    expect((s.data as { method: string }).method).toBe('spa');
  });

  it('click payload shape', () => {
    const s: BehavioralStep = {
      id: '1', type: 'click', timestamp: 0, url: 'x', tabId: 't', sessionId: 's',
      data: { selector: '#btn', text: 'Go' },
      evidenceRefs: [],
    };
    expect((s.data as { selector: string }).selector).toBe('#btn');
  });

  it('makeStep type-safe constructor returns BehavioralStep', async () => {
    const { makeStep } = await import('../../src/hunt/recorder/step-types');
    const step = makeStep('1', 'click', 0, 'x', 't', 's', { selector: '#a' });
    expect(step.type).toBe('click');
    expect((step.data as { selector: string }).selector).toBe('#a');
  });
});
