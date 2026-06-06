// tests/ci/exit-code.test.ts
import { describe, it, expect } from 'vitest';
import { computeExitCode, parseFailOn, explainExitCode, SEVERITY_RANK } from '../../src/ci/exit-code';
import type { AppModelFinding } from '../../src/core/app-model';

function f(severity: string): AppModelFinding {
  return { id: 'f', type: 'x', endpoint: '/', param: 'q', evidence: {}, confidence: 'h', confirmed: true, severity };
}

describe('CI exit code', () => {
  it('parseFailOn returns null for "none"', () => {
    expect(parseFailOn('none')).toBeNull();
  });

  it('parseFailOn returns null for undefined', () => {
    expect(parseFailOn(undefined)).toBeNull();
  });

  it('parseFailOn returns the level for known values', () => {
    expect(parseFailOn('low')).toBe('low');
    expect(parseFailOn('medium')).toBe('medium');
    expect(parseFailOn('high')).toBe('high');
    expect(parseFailOn('critical')).toBe('critical');
  });

  it('parseFailOn defaults to "high" for unknown values', () => {
    expect(parseFailOn('banana')).toBe('high');
  });

  it('computeExitCode is 0 for no findings', () => {
    expect(computeExitCode([], 'high')).toBe(0);
  });

  it('computeExitCode is 0 for findings below threshold', () => {
    expect(computeExitCode([f('low')], 'critical')).toBe(0);
    expect(computeExitCode([f('medium')], 'high')).toBe(0);
  });

  it('computeExitCode is 1 for high findings with --fail-on=high', () => {
    expect(computeExitCode([f('high')], 'high')).toBe(1);
  });

  it('computeExitCode is 2 for critical findings', () => {
    expect(computeExitCode([f('critical')], 'high')).toBe(2);
  });

  it('computeExitCode is 0 when --fail-on is none', () => {
    expect(computeExitCode([f('critical')], 'none')).toBe(0);
  });

  it('computeExitCode considers the worst finding', () => {
    const findings = [f('low'), f('medium'), f('critical')];
    expect(computeExitCode(findings, 'high')).toBe(2);
  });

  it('explainExitCode returns useful messages', () => {
    expect(explainExitCode(0, [], 'high')).toContain('No findings');
    expect(explainExitCode(1, [f('high')], 'high')).toContain('at or above');
    expect(explainExitCode(2, [f('critical')], 'high')).toContain('Critical');
    expect(explainExitCode(3, [], 'high')).toContain('internal error');
  });

  it('SEVERITY_RANK has the expected ordering', () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeGreaterThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeGreaterThan(SEVERITY_RANK.low);
    expect(SEVERITY_RANK.low).toBeGreaterThan(SEVERITY_RANK.info);
  });
});
