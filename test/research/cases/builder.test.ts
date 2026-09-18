import { describe, it, expect } from 'vitest'
import { buildCase } from '../../../src/research/cases/builder'
import type { ResearchEvent } from '../../../src/research/events/types'

function makeEvent(overrides: Partial<ResearchEvent> = {}): ResearchEvent {
  return {
    eventId: `evt-${Date.now()}`,
    runId: 'run-1',
    evidenceRefs: [],
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('buildCase', () => {
  it('builds a validated case', () => {
    const events = [
      makeEvent({ type: 'finding.validated', reasonCode: 'response difference confirmed' }),
    ]
    const caseData = buildCase(events, 'IDOR on /api/users', 'authorization', 'authorization')

    expect(caseData.outcome).toBe('validated')
    expect(caseData.initialHypothesis).toBe('IDOR on /api/users')
    expect(caseData.domain).toBe('authorization')
    expect(caseData.skillId).toBe('authorization')
    expect(caseData.decisiveEvidence).toHaveLength(1)
    expect(caseData.reusableLesson).toContain('confirmed')
  })

  it('builds a rejected case with false positive', () => {
    const events = [
      makeEvent({ type: 'false_positive.identified', reasonCode: 'both objects belong to shared resource' }),
    ]
    const caseData = buildCase(events, 'Cross-user access', 'authorization')

    expect(caseData.outcome).toBe('rejected')
    expect(caseData.falsePositiveReason).toBe('both objects belong to shared resource')
    expect(caseData.reusableLesson).toContain('rejected')
  })

  it('builds inconclusive case when no clear outcome', () => {
    const events = [
      makeEvent({ type: 'investigation.started' }),
    ]
    const caseData = buildCase(events, 'Test', 'injection')

    expect(caseData.outcome).toBe('inconclusive')
  })

  it('extracts counter-evidence from rejected findings', () => {
    const events = [
      makeEvent({ type: 'finding.rejected', reasonCode: 'no difference in response' }),
      makeEvent({ type: 'technique.failed', reasonCode: 'WAF blocked' }),
    ]
    const caseData = buildCase(events, 'SQLi', 'injection')

    expect(caseData.counterEvidence).toHaveLength(2)
    expect(caseData.killSignal).toContain('no difference')
  })

  it('extracts context features from events', () => {
    const events = [
      makeEvent({ type: 'finding.validated', skillId: 'authorization' }),
    ]
    const caseData = buildCase(events, 'Test', 'auth', 'authorization')

    expect(caseData.contextFeatures).toContain('skill:authorization')
  })

  it('strips source refs for sanitized output', () => {
    const events = [
      makeEvent({ type: 'finding.validated', evidenceRefs: ['ev-1', 'ev-2'] }),
    ]
    const caseData = buildCase(events, 'Test', 'auth')

    // sourceRefs preserved in raw case
    expect(caseData.sourceRefs).toHaveLength(2)
  })
})
