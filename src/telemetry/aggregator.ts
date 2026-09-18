/**
 * Telemetry Aggregator (Phase 0 — Baseline Instrumentation).
 *
 * Aggregates per-task telemetry into run-level summaries and
 * produces comparison diffs for measuring improvements.
 */

import type {
  TaskTelemetry,
  RunTelemetry,
  TelemetryDiff,
} from './types'

/**
 * Aggregate multiple task telemetries into a run-level summary.
 */
export function aggregateTelemetry(tasks: TaskTelemetry[]): RunTelemetry {
  if (tasks.length === 0) {
    return {
      runId: '',
      taskCount: 0,
      totalDurationMs: 0,
      tasks: [],
      avgToolsPerTask: 0,
      avgContextTokens: 0,
      totalModelCalls: 0,
      totalToolCalls: 0,
      totalEvidenceCreated: 0,
      totalCandidateFindings: 0,
      totalAcceptedFindings: 0,
      acceptanceRate: 0,
      totalInvalidToolCalls: 0,
      totalIrrelevantToolCalls: 0,
      avgRetriesPerTask: 0,
    }
  }

  const runId = tasks[0].identity.runId
  const totalDurationMs = tasks.reduce((sum, t) => sum + t.durationMs, 0)

  const avgToolsPerTask = tasks.reduce((sum, t) => sum + t.context.visibleTools.length, 0) / tasks.length

  const avgContextTokens =
    tasks.reduce((sum, t) => sum + t.context.toolSchemaTokens + t.context.skillTokens + t.context.retrievedContextTokens, 0) / tasks.length

  const totalModelCalls = tasks.reduce((sum, t) => sum + t.reasoning.modelCalls, 0)
  const totalToolCalls = tasks.reduce((sum, t) => sum + t.reasoning.toolCalls, 0)
  const totalInvalidToolCalls = tasks.reduce((sum, t) => sum + t.reasoning.invalidToolCalls, 0)
  const totalIrrelevantToolCalls = tasks.reduce((sum, t) => sum + t.reasoning.irrelevantToolCalls, 0)
  const avgRetriesPerTask = tasks.reduce((sum, t) => sum + t.reasoning.retries, 0) / tasks.length

  const totalEvidenceCreated = tasks.reduce((sum, t) => sum + t.evidence.evidenceCreated, 0)
  const totalCandidateFindings = tasks.reduce((sum, t) => sum + t.evidence.candidateFindings, 0)
  const totalAcceptedFindings = tasks.reduce((sum, t) => sum + t.evidence.acceptedFindings, 0)
  const acceptanceRate = totalCandidateFindings > 0 ? totalAcceptedFindings / totalCandidateFindings : 0

  return {
    runId,
    taskCount: tasks.length,
    totalDurationMs,
    tasks,
    avgToolsPerTask,
    avgContextTokens,
    totalModelCalls,
    totalToolCalls,
    totalEvidenceCreated,
    totalCandidateFindings,
    totalAcceptedFindings,
    acceptanceRate,
    totalInvalidToolCalls,
    totalIrrelevantToolCalls,
    avgRetriesPerTask,
  }
}

/**
 * Compare baseline vs improved telemetry, producing a diff report.
 * Positive values = improvement (reduction in bad metrics, increase in good).
 */
export function compareTelemetry(baseline: RunTelemetry, improved: RunTelemetry): TelemetryDiff {
  const contextReduction = pctChange(baseline.avgContextTokens, improved.avgContextTokens)
  const toolReduction = pctChange(baseline.avgToolsPerTask, improved.avgToolsPerTask)
  const invalidCallReduction = pctChange(baseline.totalInvalidToolCalls, improved.totalInvalidToolCalls)
  const acceptanceRateChange = improved.acceptanceRate - baseline.acceptanceRate
  const durationChange = pctChange(baseline.totalDurationMs, improved.totalDurationMs)

  return {
    contextReduction,
    toolReduction,
    invalidCallReduction,
    acceptanceRateChange,
    durationChange,
  }
}

/**
 * Format a diff report as a human-readable string.
 */
export function formatDiffReport(diff: TelemetryDiff): string {
  const lines = [
    '## Telemetry Comparison',
    '',
    `Context tokens:   ${fmtPct(diff.contextReduction)} reduction`,
    `Visible tools:    ${fmtPct(diff.toolReduction)} reduction`,
    `Invalid calls:    ${fmtPct(diff.invalidCallReduction)} reduction`,
    `Acceptance rate:  ${diff.acceptanceRateChange >= 0 ? '+' : ''}${(diff.acceptanceRateChange * 100).toFixed(1)}pp`,
    `Duration:         ${fmtPct(diff.durationChange)} change`,
  ]
  return lines.join('\n')
}

// ─── Internal ───────────────────────────────────────────────────────────────

/** Percentage change: positive = reduction (improvement) */
function pctChange(oldVal: number, newVal: number): number {
  if (oldVal === 0) return 0
  return ((oldVal - newVal) / oldVal) * 100
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}
