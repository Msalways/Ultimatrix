import type { FindingCandidate } from './types'

export interface VerificationAssessment {
  ready: boolean
  missing: string[]
  reportChecklist: string[]
}

export function assessCandidateForReport(candidate: FindingCandidate): VerificationAssessment {
  const missing: string[] = []
  const joinedEvidence = candidate.evidence.join('\n').toLowerCase()

  if (candidate.evidence.length < 3) missing.push('at least three evidence items')
  if (!joinedEvidence.includes('status')) missing.push('HTTP status comparison')
  if (!joinedEvidence.includes('raw') && !joinedEvidence.includes('response')) missing.push('raw request/response evidence')
  if (candidate.confidence < 0.7) missing.push('confidence >= 0.7')
  if (candidate.status === 'needs-more-evidence') missing.push('candidate still needs more evidence')

  return {
    ready: missing.length === 0,
    missing,
    reportChecklist: [
      'Title states the concrete broken control.',
      'Steps reproduce with exact actor/session setup.',
      'Actual result includes raw response or UI proof.',
      'Expected result explains secure behavior.',
      'Impact names exposed, modified, or bypassed data/state.',
      'Suggested fix is scoped to server-side authorization/workflow validation.',
    ],
  }
}
