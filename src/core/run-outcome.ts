export type RunOutcomeKind =
  | 'answered'
  | 'completed'
  | 'completed_no_findings'
  | 'stopped'
  | 'interrupted'
  | 'failed'

export interface RunOutcomeInput {
  completed?: boolean
  reason?: string
  toolCalls?: number
  newFindings?: number
  durationMs?: number
  error?: string
}

export interface RunOutcome {
  kind: RunOutcomeKind
  label: string
  detail: string
}

export function deriveRunOutcome(input: RunOutcomeInput): RunOutcome {
  const toolCalls = input.toolCalls ?? 0
  const findings = input.newFindings ?? 0

  if (input.error) {
    return { kind: 'failed', label: 'Run failed', detail: input.error }
  }

  if (input.reason === 'interrupted') {
    return {
      kind: 'interrupted',
      label: 'Run interrupted',
      detail: 'Progress was saved. You can resume from the same target.',
    }
  }

  if (input.reason === 'response_complete' || (toolCalls === 0 && input.reason === 'frontier_exhausted')) {
    return {
      kind: 'answered',
      label: 'Answered from session context',
      detail: 'No assessment actions were run.',
    }
  }

  if (input.completed || findings > 0) {
    return {
      kind: 'completed',
      label: findings === 1 ? 'Assessment produced 1 finding' : `Assessment produced ${findings} findings`,
      detail: `${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'} completed.`,
    }
  }

  if (toolCalls > 0 && input.reason === 'frontier_exhausted') {
    return {
      kind: 'completed_no_findings',
      label: 'Pass completed with no new findings',
      detail: `${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'} ran. This is not proof that the target is secure.`,
    }
  }

  return {
    kind: 'stopped',
    label: input.reason === 'budget_reached' ? 'Run reached its budget' : 'Run stopped before making progress',
    detail: toolCalls > 0
      ? `${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'} completed before the run stopped.`
      : 'No assessment actions completed.',
  }
}

