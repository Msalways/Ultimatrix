import { describe, expect, it } from 'vitest'
import { buildCiAssessmentResult, ciExitCode } from '../../src/ci/result'

const caseFile: any = {
  schemaVersion: 1,
  metadata: { target: 'https://target.example', generatedAt: 'now', totalFindings: 1, totalEndpoints: 0 },
  findings: [{ id: 'f1', severity: 'high', type: 'test', endpoint: 'https://target.example' }],
  incompleteCandidates: [{ id: 'candidate-1', reasons: ['missing retest'] }],
  decisionLog: [], endpoints: [],
}

describe('CI result contract', () => {
  it('emits a stable schema and gates only verified severity', () => {
    const result = buildCiAssessmentResult(caseFile, 'workflow-1', 123)
    expect(result).toMatchObject({ schemaVersion: 1, workflowRef: 'workflow-1', status: 'complete' })
    expect(ciExitCode(result, 'high')).toBe(1)
    expect(ciExitCode(result, 'critical')).toBe(0)
    expect(ciExitCode(result, 'none')).toBe(0)
  })

  it('uses exit code 2 for incomplete execution', () => {
    const result = buildCiAssessmentResult(caseFile, 'workflow-1')
    result.status = 'failed'
    expect(ciExitCode(result)).toBe(2)
  })
})
