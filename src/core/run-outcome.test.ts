import { describe, expect, it } from 'vitest'
import { deriveRunOutcome } from './run-outcome'

describe('deriveRunOutcome', () => {
  it('treats a zero-tool response as an answer', () => {
    expect(deriveRunOutcome({
      reason: 'response_complete',
      toolCalls: 0,
      newFindings: 0,
    }).kind).toBe('answered')
  })

  it('does not present a zero-finding pass as proof of safety', () => {
    const outcome = deriveRunOutcome({
      reason: 'frontier_exhausted',
      toolCalls: 4,
      newFindings: 0,
    })

    expect(outcome.kind).toBe('completed_no_findings')
    expect(outcome.detail).toContain('not proof')
  })

  it('prioritizes errors over completion metadata', () => {
    expect(deriveRunOutcome({
      completed: true,
      reason: 'goal_achieved',
      toolCalls: 3,
      newFindings: 1,
      error: 'provider unavailable',
    }).kind).toBe('failed')
  })
})
