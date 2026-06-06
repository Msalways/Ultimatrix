// tests/report/html.test.ts
import { describe, it, expect } from 'vitest';
import { renderHtmlReport, buildSelfContainedReport } from '../../src/report/html';
import type { AppModelFinding } from '../../src/core/app-model';

function f(overrides: Partial<AppModelFinding> = {}): AppModelFinding {
  return { id: 'f1', type: 'reflected-xss', endpoint: 'https://x.com/search', param: 'q', method: 'GET', evidence: { responseContains: '<svg' }, confidence: 'high', confirmed: true, severity: 'high', description: 'Payload appears in response body.', ...overrides };
}

describe('HTML report', () => {
  it('produces valid HTML with DOCTYPE', () => {
    const html = renderHtmlReport({ target: 'https://x.com', startedAt: 1000, durationMs: 5000, cost: 0.42, findings: [], diff: null });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the target', () => {
    const html = renderHtmlReport({ target: 'https://target.com', startedAt: 1000, durationMs: 5000, cost: 0, findings: [], diff: null });
    expect(html).toContain('https://target.com');
  });

  it('includes each finding', () => {
    const html = renderHtmlReport({ target: 't', startedAt: 0, durationMs: 0, cost: 0, findings: [f(), f({ id: 'f2', type: 'sqli', severity: 'critical' })], diff: null });
    expect(html).toContain('reflected-xss');
    expect(html).toContain('sqli');
  });

  it('escapes HTML in target', () => {
    const html = renderHtmlReport({ target: '<script>alert(1)</script>', startedAt: 0, durationMs: 0, cost: 0, findings: [], diff: null });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('shows severity counts', () => {
    const html = renderHtmlReport({ target: 't', startedAt: 0, durationMs: 0, cost: 0, findings: [
      f({ severity: 'critical' }), f({ severity: 'high' }), f({ severity: 'medium' }),
    ], diff: null });
    expect(html).toContain('Critical');
    expect(html).toContain('High');
    expect(html).toContain('Medium');
  });

  it('shows "No findings" when empty', () => {
    const html = renderHtmlReport({ target: 't', startedAt: 0, durationMs: 0, cost: 0, findings: [], diff: null });
    expect(html).toContain('No findings');
  });

  it('includes diff section when diff provided', () => {
    const html = renderHtmlReport({
      target: 't', startedAt: 0, durationMs: 0, cost: 0, findings: [],
      diff: { previousHuntAt: 1000, added: [], fixed: [], regressed: [], unchanged: [], removedFingerprints: [] },
    });
    expect(html).toContain('Diff vs Last Hunt');
  });

  it('shows "first hunt" when no previous snapshot', () => {
    const html = renderHtmlReport({
      target: 't', startedAt: 0, durationMs: 0, cost: 0, findings: [],
      diff: { previousHuntAt: 0, added: [], fixed: [], regressed: [], unchanged: [], removedFingerprints: [] },
    });
    expect(html).toContain('First hunt');
  });

  it('includes Regenerate tests and Share buttons', () => {
    const html = renderHtmlReport({ target: 't', startedAt: 0, durationMs: 0, cost: 0, findings: [], diff: null });
    expect(html).toContain('Regenerate tests');
    expect(html).toContain('Share');
  });

  it('includes inline screenshot when provided', () => {
    const html = renderHtmlReport({
      target: 't', startedAt: 0, durationMs: 0, cost: 0,
      findings: [f()],
      screenshots: { f1: ['data:image/png;base64,XXX'] },
      diff: null,
    });
    expect(html).toContain('data:image/png;base64,XXX');
  });

  it('buildSelfContainedReport is the same as renderHtmlReport', () => {
    const opts = { target: 't', startedAt: 0, durationMs: 0, cost: 0, findings: [f()], diff: null };
    expect(buildSelfContainedReport(opts)).toBe(renderHtmlReport(opts));
  });
});
