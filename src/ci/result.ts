import type { CaseFile } from '../report/case-file'

export const CI_RESULT_SCHEMA_VERSION = 1

export type CiStatus = 'complete' | 'incomplete' | 'failed'
export type CiSeverityThreshold = 'low' | 'medium' | 'high' | 'critical' | 'none'

export interface CiAssessmentResult {
  schemaVersion: typeof CI_RESULT_SCHEMA_VERSION
  workflowRef: string
  status: CiStatus
  verifiedFindings: Array<{ id: string; severity: string; type: string; endpoint: string }>
  candidates: Array<{ id: string; reasons: string[] }>
  executionErrors: Array<{ message: string }>
  artifactRefs: string[]
  metrics: { durationMs: number; verifiedFindings: number; incompleteCandidates: number }
}

export function buildCiAssessmentResult(
  caseFile: CaseFile,
  workflowRef: string,
  durationMs = 0,
): CiAssessmentResult {
  return {
    schemaVersion: CI_RESULT_SCHEMA_VERSION,
    workflowRef,
    status: 'complete',
    verifiedFindings: caseFile.findings.map(finding => ({
      id: finding.id,
      severity: finding.severity,
      type: finding.type,
      endpoint: finding.endpoint,
    })),
    candidates: caseFile.incompleteCandidates,
    executionErrors: [],
    artifactRefs: [],
    metrics: {
      durationMs,
      verifiedFindings: caseFile.findings.length,
      incompleteCandidates: caseFile.incompleteCandidates.length,
    },
  }
}

const severityRank: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

export function ciExitCode(result: CiAssessmentResult, failOn: CiSeverityThreshold = 'high'): number {
  if (result.status !== 'complete' || result.executionErrors.length > 0) return 2
  if (failOn === 'none') return 0
  const threshold = severityRank[failOn]
  return result.verifiedFindings.some(finding => (severityRank[finding.severity] ?? 0) >= threshold) ? 1 : 0
}
