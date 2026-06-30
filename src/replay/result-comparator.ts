import type { TestResult } from './test-runner'

export interface ComparisonResult {
  newFindings: TestResult[]
  fixedFindings: TestResult[]
  changedFindings: TestResult[]
  unchanged: TestResult[]
  summary: string
}

export function compareResults(baseline: TestResult[], current: TestResult[]): ComparisonResult {
  const baselineMap = new Map(baseline.map(r => [r.testName, r]))
  const currentMap = new Map(current.map(r => [r.testName, r]))

  const newFindings: TestResult[] = []
  const fixedFindings: TestResult[] = []
  const changedFindings: TestResult[] = []
  const unchanged: TestResult[] = []

  // Check current results
  for (const [name, result] of currentMap) {
    const baseResult = baselineMap.get(name)
    if (!baseResult) {
      newFindings.push(result)
    } else if (baseResult.status !== result.status) {
      changedFindings.push(result)
    } else {
      unchanged.push(result)
    }
  }

  // Check for fixed findings
  for (const [name, result] of baselineMap) {
    if (!currentMap.has(name)) {
      fixedFindings.push(result)
    }
  }

  const summary = buildSummary(newFindings, fixedFindings, changedFindings, unchanged)

  return {
    newFindings,
    fixedFindings,
    changedFindings,
    unchanged,
    summary,
  }
}

function buildSummary(
  newFindings: TestResult[],
  fixedFindings: TestResult[],
  changedFindings: TestResult[],
  unchanged: TestResult[]
): string {
  const lines: string[] = []

  lines.push('## Comparison Summary')
  lines.push(`- ${newFindings.length} new findings`)
  lines.push(`- ${fixedFindings.length} fixed findings`)
  lines.push(`- ${changedFindings.length} changed findings`)
  lines.push(`- ${unchanged.length} unchanged`)

  if (newFindings.length > 0) {
    lines.push('\n### New Findings')
    for (const f of newFindings) {
      lines.push(`- ${f.testName}: ${f.status}`)
    }
  }

  if (fixedFindings.length > 0) {
    lines.push('\n### Fixed Findings')
    for (const f of fixedFindings) {
      lines.push(`- ${f.testName}: ${f.status}`)
    }
  }

  return lines.join('\n')
}
