// tests/hunt/behavioral-analyzer.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { BehavioralAnalyzer, serialiseBehavioralModel } from '../../src/hunt/observation/analyzer';
import type { BehavioralStep } from '../../src/hunt/recorder/step-types';

function step(
  id: string,
  type: BehavioralStep['type'],
  data: unknown,
  url = 'https://target.com/p',
  timestamp = 0
): BehavioralStep {
  return { id, type, timestamp, url, tabId: 't1', sessionId: 's1', data, evidenceRefs: [] };
}

describe('BehavioralAnalyzer', () => {
  let a: BehavioralAnalyzer;
  beforeEach(() => { a = new BehavioralAnalyzer(); });

  it('tracks pagesVisited', () => {
    a.ingest(step('1', 'navigate', { url: 'https://x/a', method: 'hard' }, 'https://x/a'));
    a.ingest(step('2', 'navigate', { url: 'https://x/b', method: 'hard' }, 'https://x/b'));
    expect(a.getModel().pagesVisited.has('https://x/a')).toBe(true);
    expect(a.getModel().pagesVisited.has('https://x/b')).toBe(true);
  });

  it('aggregates API calls by method+url', () => {
    a.ingest(step('1', 'request', { method: 'GET', url: 'https://x/api/u', headers: {}, resourceType: 'fetch' }));
    a.ingest(step('2', 'request', { method: 'GET', url: 'https://x/api/u', headers: {}, resourceType: 'fetch' }));
    a.ingest(step('3', 'request', { method: 'POST', url: 'https://x/api/u', headers: {}, resourceType: 'fetch', body: '{}' }));
    const apis = Array.from(a.getModel().apis.values());
    expect(apis.length).toBe(2);
    const get = apis.find((x) => x.method === 'GET')!;
    expect(get.callCount).toBe(2);
    expect(apis.find((x) => x.method === 'POST')!.callCount).toBe(1);
  });

  it('updates API status from response', () => {
    a.ingest(step('1', 'request', { method: 'GET', url: 'https://x/api/u', headers: {}, resourceType: 'fetch' }));
    a.ingest(step('2', 'response', { url: 'https://x/api/u', status: 200, statusText: 'OK', headers: {}, bodyPreview: '{}', bodySize: 2, contentType: 'application/json', latencyMs: 50, fromCache: false }));
    const api = a.getModel().apis.get('GET https://x/api/u')!;
    expect(api.avgStatus).toBe(200);
    expect(api.lastBodyPreview).toBe('{}');
  });

  it('collects console errors', () => {
    a.ingest(step('1', 'console', { level: 'error', text: 'TypeError: x is undefined' }));
    a.ingest(step('2', 'console', { level: 'error', text: 'NetworkError' }));
    expect(a.getModel().consoleErrors).toEqual(['TypeError: x is undefined', 'NetworkError']);
  });

  it('aggregates errors by kind+message', () => {
    a.ingest(step('1', 'error', { kind: 'js', message: 'undefined' }));
    a.ingest(step('2', 'error', { kind: 'js', message: 'undefined' }));
    a.ingest(step('3', 'error', { kind: 'network', message: '500' }));
    const errors = Array.from(a.getModel().errors.values());
    expect(errors.length).toBe(2);
    expect(errors.find((e) => e.kind === 'js')!.count).toBe(2);
  });

  it('tracks storage keys', () => {
    a.ingest(step('1', 'storage', { kind: 'localStorage', op: 'set', key: 'token', value: 'abc' }));
    a.ingest(step('2', 'storage', { kind: 'localStorage', op: 'set', key: 'token', value: 'xyz' }));
    const k = a.getModel().storageKeys.get('localStorage::token')!;
    expect(k.setCount).toBe(2);
    expect(k.lastValue).toBe('xyz');
  });

  it('counts mutations', () => {
    a.ingest(step('1', 'mutation', { kind: 'added', selector: 'div', significance: 0.5 }));
    a.ingest(step('2', 'mutation', { kind: 'removed', selector: 'span', significance: 0.4 }));
    expect(a.getModel().mutationCount).toBe(2);
  });

  it('finalises flows on navigate', () => {
    a.ingest(step('1', 'click', { selector: '#btn' }));
    a.ingest(step('2', 'click', { selector: '#submit' }));
    a.ingest(step('3', 'navigate', { url: 'https://x/done', method: 'spa' }));
    a.finaliseCurrentFlow('hunt ended');
    // The 2 clicks were finalised on the navigate. The empty post-navigate flow
    // yields nothing. The external finalise call on an empty flow also yields nothing.
    expect(a.getModel().flows.length).toBe(1);
    expect(a.getModel().flows[0].steps).toEqual(['1', '2']);
  });

  it('serialises to plain object', () => {
    a.ingest(step('1', 'request', { method: 'GET', url: 'https://x/api/u', headers: {}, resourceType: 'fetch' }));
    a.ingest(step('2', 'response', { url: 'https://x/api/u', status: 200, statusText: 'OK', headers: {}, bodyPreview: '{}', bodySize: 2, contentType: 'application/json', latencyMs: 50, fromCache: false }));
    const ser = serialiseBehavioralModel(a.getModel());
    expect(Array.isArray(ser.apis)).toBe(true);
    expect(ser.apis).toHaveLength(1);
  });

  it('resets cleanly', () => {
    a.ingest(step('1', 'request', { method: 'GET', url: 'https://x/api/u', headers: {}, resourceType: 'fetch' }));
    a.reset();
    expect(a.getModel().apis.size).toBe(0);
    expect(a.getModel().pagesVisited.size).toBe(0);
  });
});
