import type { TestResult } from './test-runner'

export interface Regression {
  testName: string
  type: 'new-failure' | 'status-change' | 'performance-regression'
  severity: 'high' | 'medium' | 'low'
  description: string
  baseline: TestResult
  current: TestResult
}

export function detectRegressions(baseline: TestResult[], current: TestResult[]): Regression[] {
  const regressions: Regression[] = []
  const baselineMap = new Map(baseline.map(r => [r.testName, r]))

  for (const currentResult of current) {
    const baseResult = baselineMap.get(currentResult.testName)
    if (!baseResult) continue

    // New failure
    if (baseResult.status === 'passed' && currentResult.status === 'failed') {
      regressions.push({
        testName: currentResult.testName,
        type: 'new-failure',
        severity: 'high',
        description: `Test that was passing is now failing`,
        baseline: baseResult,
        current: currentResult,
      })
    }

    // Status change
    if (baseResult.status !== currentResult.status) {
      regressions.push({
        testName: currentResult.testName,
        type: 'status-change',
        severity: 'medium',
        description: `Status changed from ${baseResult.status} to ${currentResult.status}`,
        baseline: baseResult,
        current: currentResult,
      })
    }

    // Performance regression (2x slower)
    if (currentResult.duration > baseResult.duration * 2 && currentResult.duration > 1000) {
      regressions.push({
        testName: currentResult.testName,
        type: 'performance-regression',
        severity: 'low',
        description: `Test is ${Math.round(currentResult.duration / baseResult.duration)}x slower`,
        baseline: baseResult,
        current: currentResult,
      })
    }
  }

  return regressions
}
