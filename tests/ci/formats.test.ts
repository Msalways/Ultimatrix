// tests/ci/formats.test.ts
import { describe, it, expect } from 'vitest';
import { toJson, toPlain, toSarif, formatCiOutput } from '../../src/ci/formats';
import type { AppModelFinding } from '../../src/core/app-model';

const f1: AppModelFinding = {
  id: 'f1', type: 'reflected-xss', endpoint: 'https://x.com/search', param: 'q', method: 'GET',
  payload: '<svg/onload=alert(1)>',
  evidence: { responseContains: '<svg/onload=alert(1)>' },
  confidence: 'high', confirmed: true, severity: 'high',
  description: 'Payload appears unescaped in response body.',
};
const f2: AppModelFinding = {
  id: 'f2', type: 'sql-injection', endpoint: 'https://x.com/users', param: 'id', method: 'GET',
  evidence: {}, confidence: 'medium', confirmed: false, severity: 'critical',
};

describe('CI formatters', () => {
  const opts = {
    target: 'https://x.com',
    findings: [f1, f2],
    startedAt: 1000,
    endedAt: 5000,
    costUsd: 0.42,
    exitCode: 1,
  };

  it('toJson produces valid JSON', () => {
    const out = toJson(opts);
    const parsed = JSON.parse(out);
    expect(parsed.target).toBe('https://x.com');
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.costUsd).toBe(0.42);
  });

  it('toPlain produces human-readable text', () => {
    const out = toPlain(opts);
    expect(out).toContain('Ultimatrix hunt report');
    expect(out).toContain('reflected-xss');
    expect(out).toContain('https://x.com/search');
    expect(out).toContain('HIGH');
    expect(out).toContain('CRITICAL');
  });

  it('toSarif produces valid SARIF 2.1.0', () => {
    const out = toSarif(opts);
    const sarif = JSON.parse(out);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('ultimatrix');
    expect(sarif.runs[0].results).toHaveLength(2);
    expect(sarif.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
  });

  it('SARIF results have proper levels', () => {
    const out = toSarif(opts);
    const sarif = JSON.parse(out);
    const critical = sarif.runs[0].results.find((r: { ruleId: string }) => r.ruleId === 'sql-injection');
    expect(critical.level).toBe('error');
    const high = sarif.runs[0].results.find((r: { ruleId: string }) => r.ruleId === 'reflected-xss');
    expect(high.level).toBe('error');
  });

  it('SARIF includes security-severity score', () => {
    const out = toSarif(opts);
    const sarif = JSON.parse(out);
    const critical = sarif.runs[0].results.find((r: { ruleId: string }) => r.ruleId === 'sql-injection');
    expect(critical.properties['security-severity']).toBe(9.5);
  });

  it('SARIF handles empty findings', () => {
    const out = toSarif({ ...opts, findings: [] });
    const sarif = JSON.parse(out);
    expect(sarif.runs[0].results).toEqual([]);
    expect(sarif.runs[0].tool.driver.rules).toEqual([]);
  });

  it('formatCiOutput dispatches on format', () => {
    expect(formatCiOutput('json', opts).format).toBe('json');
    expect(formatCiOutput('plain', opts).format).toBe('plain');
    expect(formatCiOutput('sarif', opts).format).toBe('sarif');
  });

  it('unknown severity maps to "none" in SARIF', () => {
    const f: AppModelFinding = { id: 'f', type: 'mystery', endpoint: '/', evidence: {}, confidence: 'low', confirmed: false, severity: 'banana' };
    const out = toSarif({ ...opts, findings: [f] });
    const sarif = JSON.parse(out);
    expect(sarif.runs[0].results[0].level).toBe('none');
  });
});
