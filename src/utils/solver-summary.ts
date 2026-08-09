import type { SolveResult } from '../solver/solver'
import { deriveRunOutcome } from '../core/run-outcome'
import { log } from './logger'

export function logSolveSummary(result: SolveResult): void {
  const outcome = deriveRunOutcome(result)

  switch (outcome.kind) {
    case 'completed':
      log.success(outcome.label)
      break
    case 'answered':
      log.dim(outcome.label)
      break
    case 'failed':
      log.error(outcome.label)
      break
    default:
      log.warn(outcome.label)
      break
  }

  if (outcome.kind !== 'failed') log.dim(outcome.detail)
  log.dim(
    `${formatDuration(result.durationMs)} | ${result.toolCalls} tool ${result.toolCalls === 1 ? 'call' : 'calls'} | ${result.newFindings} new ${result.newFindings === 1 ? 'finding' : 'findings'}`,
  )
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
