export type RunOutcomeKind =
  | 'answered'
  | 'run_no_actions'
  | 'grounding_failed'
  | 'completed'
  | 'completed_no_findings'
  | 'stopped'
  | 'interrupted'
  | 'failed'

export interface RunOutcomeInput {
  interactionMode?: 'ask' | 'run'
  completed?: boolean
  reason?: string
  toolCalls?: number
  steps?: number
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

  if (input.reason === 'grounding_failed') {
    return {
      kind: 'grounding_failed',
      label: 'Target grounding failed',
      detail: input.error || 'The browser/crawler did not observe a page, endpoint, or form.',
    }
  }

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

  if (toolCalls === 0 && input.interactionMode === 'run' && (input.reason === 'response_complete' || input.reason === 'frontier_exhausted')) {
    return {
      kind: 'run_no_actions',
      label: 'No assessment actions ran',
      detail: 'Run mode did not activate browser, crawl, worker, or testing tools.',
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

export function shouldRenderRunSummary(input: RunOutcomeInput): boolean {
  const toolCalls = input.toolCalls ?? 0
  const steps = input.steps ?? 0
  const findings = input.newFindings ?? 0

  if (input.error) return true
  if (input.reason === 'grounding_failed' || input.reason === 'interrupted') return true
  if (input.completed || toolCalls > 0 || steps > 0 || findings > 0) return true
  if (input.interactionMode === 'run' && (input.reason === 'response_complete' || input.reason === 'frontier_exhausted')) return true

  return false
}
