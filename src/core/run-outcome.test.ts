import { describe, expect, it } from 'vitest'
import { deriveRunOutcome, shouldRenderRunSummary } from './run-outcome'

describe('deriveRunOutcome', () => {
  it('treats an ask-mode zero-tool response as an answer', () => {
    expect(deriveRunOutcome({
      interactionMode: 'ask',
      reason: 'response_complete',
      toolCalls: 0,
      newFindings: 0,
    }).kind).toBe('answered')
  })

  it('does not treat a run-mode zero-tool response as an assessment', () => {
    const outcome = deriveRunOutcome({
      interactionMode: 'run',
      reason: 'response_complete',
      toolCalls: 0,
      newFindings: 0,
    })

    expect(outcome.kind).toBe('run_no_actions')
    expect(outcome.label).toContain('No assessment actions')
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

  it('surfaces grounding failure distinctly from answered context', () => {
    const outcome = deriveRunOutcome({
      interactionMode: 'run',
      reason: 'grounding_failed',
      toolCalls: 1,
      error: 'Target grounding failed: no page was observed',
    })

    expect(outcome.kind).toBe('grounding_failed')
    expect(outcome.label).toContain('grounding failed')
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

  it('does not render a run summary for an auto conversational zero-tool turn', () => {
    expect(shouldRenderRunSummary({
      reason: 'response_complete',
      toolCalls: 0,
      steps: 0,
      newFindings: 0,
    })).toBe(false)
  })

  it('renders a run summary for explicit run mode with no actions', () => {
    expect(shouldRenderRunSummary({
      interactionMode: 'run',
      reason: 'response_complete',
      toolCalls: 0,
      steps: 0,
      newFindings: 0,
    })).toBe(true)
  })

  it('renders a run summary when tools or failures happened', () => {
    expect(shouldRenderRunSummary({ toolCalls: 1, reason: 'frontier_exhausted' })).toBe(true)
    expect(shouldRenderRunSummary({ reason: 'grounding_failed' })).toBe(true)
    expect(shouldRenderRunSummary({ error: 'model failed' })).toBe(true)
  })
})
