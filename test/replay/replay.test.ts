import { describe, it, expect } from 'vitest'
import { compareResults } from '../../src/replay/result-comparator'
import { detectRegressions } from '../../src/replay/regression-detector'
import { generateReport } from '../../src/report/generator'
import type { TestResult } from '../../src/replay/test-runner'
import type { Finding } from '../../src/generation/test-generator'

const baselineResults: TestResult[] = [
  { testFile: 'a.spec.ts', testName: 'test-a', status: 'passed', duration: 100 },
  { testFile: 'b.spec.ts', testName: 'test-b', status: 'passed', duration: 200 },
  { testFile: 'c.spec.ts', testName: 'test-c', status: 'passed', duration: 150 },
]

const currentResults: TestResult[] = [
  { testFile: 'a.spec.ts', testName: 'test-a', status: 'passed', duration: 100 },
  { testFile: 'b.spec.ts', testName: 'test-b', status: 'failed', duration: 300 },
  { testFile: 'd.spec.ts', testName: 'test-d', status: 'passed', duration: 120 },
]

const mockFindings: Finding[] = [
  {
    id: 'f1',
    title: 'IDOR vulnerability',
    severity: 'high',
    category: 'authorization',
    description: 'User can access other users data',
    evidence: [],
    request: { method: 'GET', url: 'https://example.com/users/123' },
    firstSeen: new Date(),
    lastSeen: new Date(),
    status: 'open',
  },
  {
    id: 'f2',
    title: 'Verbose errors',
    severity: 'low',
    category: 'information-disclosure',
    description: 'Stack traces in error responses',
    evidence: [],
    request: { method: 'GET', url: 'https://example.com/error' },
    firstSeen: new Date(),
    lastSeen: new Date(),
    status: 'open',
  },
]

describe('Result Comparator', () => {
  it('should detect new findings', () => {
    const result = compareResults(baselineResults, currentResults)
    expect(result.newFindings).toHaveLength(1)
    expect(result.newFindings[0].testName).toBe('test-d')
  })

  it('should detect fixed findings', () => {
    const result = compareResults(baselineResults, currentResults)
    expect(result.fixedFindings).toHaveLength(1)
    expect(result.fixedFindings[0].testName).toBe('test-c')
  })

  it('should detect changed findings', () => {
    const result = compareResults(baselineResults, currentResults)
    expect(result.changedFindings).toHaveLength(1)
    expect(result.changedFindings[0].testName).toBe('test-b')
  })

  it('should build summary', () => {
    const result = compareResults(baselineResults, currentResults)
    expect(result.summary).toContain('new findings')
    expect(result.summary).toContain('fixed findings')
  })
})

describe('Regression Detector', () => {
  it('should detect new failures', () => {
    const regressions = detectRegressions(baselineResults, currentResults)
    expect(regressions.some(r => r.type === 'new-failure')).toBe(true)
  })

  it('should detect status changes', () => {
    const regressions = detectRegressions(baselineResults, currentResults)
    expect(regressions.some(r => r.type === 'status-change')).toBe(true)
  })

  it('should detect performance regressions', () => {
    const slowResults: TestResult[] = [
      { testFile: 'a.spec.ts', testName: 'test-a', status: 'passed', duration: 10000 },
    ]
    const fastBaseline: TestResult[] = [
      { testFile: 'a.spec.ts', testName: 'test-a', status: 'passed', duration: 100 },
    ]
    const regressions = detectRegressions(fastBaseline, slowResults)
    expect(regressions.some(r => r.type === 'performance-regression')).toBe(true)
  })

  it('should return empty for no regressions', () => {
    const regressions = detectRegressions(baselineResults, baselineResults)
    expect(regressions).toHaveLength(0)
  })
})

describe('Report Generator', () => {
  it('should generate JSON report', () => {
    const report = generateReport(mockFindings, baselineResults, { format: 'json' })
    const parsed = JSON.parse(report)
    expect(parsed.summary.totalFindings).toBe(2)
    expect(parsed.summary.high).toBe(1)
  })

  it('should generate HTML report', () => {
    const report = generateReport(mockFindings, baselineResults, { format: 'html' })
    expect(report).toContain('<!DOCTYPE html>')
    expect(report).toContain('IDOR vulnerability')
  })

  it('should generate Markdown report', () => {
    const report = generateReport(mockFindings, baselineResults, { format: 'markdown' })
    expect(report).toContain('# Ultimatrix Security Report')
    expect(report).toContain('IDOR vulnerability')
    expect(report).toContain('HIGH')
    expect(report).toContain('GET https://example.com/users/123')
  })
})
