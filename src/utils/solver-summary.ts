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
  if (result.assessmentStatus) {
    const report = result.assessmentReport
    if (!report) {
      log.warn(`Coverage assessment is ${result.assessmentStatus}; structured details are unavailable.`)
      return
    }
    const d = report.discovery
    const m = report.targetModel
    const t = report.testedCoverage
    const hypotheses = Object.entries(m.hypothesesByKind).map(([kind, count]) => `${kind} ${count}`).join(', ') || 'none'
    const experiments = Object.entries(m.experimentsByStatus).map(([status, count]) => `${status} ${count}`).join(', ') || 'none queued'
    const label = report.status === 'complete' ? log.success : log.warn
    const workflowUnits = Object.entries(t.workflowUnits).map(([status, count]) => `${status} ${count}`).join(', ') || 'none'
    const businessLogicUnits = Object.entries(t.businessLogicUnits).map(([status, count]) => `${status} ${count}`).join(', ') || 'none'
    label(`Assessment ${report.status}: observed workflow sequences ${d.workflows}, ${m.entities} entities, ${m.businessLogicFacts} business-logic facts, ${m.hypotheses} hypotheses; discovered ${d.endpoints} endpoints, ${d.inputs} inputs, ${d.roles} roles; tested ${t.executed}/${t.planned} units, ${t.confirmed} confirmed, ${t.remaining} remaining, ${t.requestsUsed} HTTP requests.`)
    log.dim(`Hypothesis classes: ${hypotheses}.`)
    log.dim(`Workflow probes: ${workflowUnits}. Business-logic probes: ${businessLogicUnits}.`)
    log.dim(`Coverage dimensions: endpoints ${t.dimensions.endpoints.covered}/${t.dimensions.endpoints.total}, actors ${t.dimensions.actors.covered}/${t.dimensions.actors.total}, roles ${t.dimensions.roles.covered}/${t.dimensions.roles.total}, states ${t.dimensions.states.covered}/${t.dimensions.states.total}, techniques ${t.dimensions.techniques.planned}/${t.dimensions.techniques.total}.`)
    log.dim(`Research experiments: ${experiments}.`)
    for (const unknown of d.unknowns) log.dim(`Unknown: ${unknown}`)
    for (const blocker of report.blockers) log.warn(`Blocker: ${blocker}`)
    for (const work of report.remainingWork) log.dim(`Remaining: ${work}`)
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
