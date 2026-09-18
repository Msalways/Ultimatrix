/**
 * Benchmark Harness (Phase 10).
 *
 * Compares baseline vs compiled runtime and emits machine-readable metrics.
 * Uses the TelemetryRecorder (Phase 0) and compareTelemetry() for diffing.
 *
 * Usage:
 *   const harness = new BenchmarkHarness()
 *   harness.recordBaseline('task-1', baselineTelemetry)
 *   harness.recordImproved('task-1', improvedTelemetry)
 *   const report = harness.generateReport()
 */

import type { TaskTelemetry, RunTelemetry, TelemetryDiff } from '../telemetry/types'
import { aggregateTelemetry, compareTelemetry, formatDiffReport } from '../telemetry/aggregator'

export interface BenchmarkTask {
  taskId: string
  skillId: string
  baseline?: TaskTelemetry
  improved?: TaskTelemetry
}

export interface BenchmarkReport {
  /** Number of tasks compared */
  taskCount: number
  /** Aggregate diff across all tasks */
  aggregateDiff: TelemetryDiff
  /** Per-task diffs */
  taskDiffs: Array<{
    taskId: string
    skillId: string
    diff: TelemetryDiff
  }>
  /** Human-readable summary */
  summary: string
  /** Whether the compiled runtime shows measurable improvement */
  hasImprovement: boolean
}

export class BenchmarkHarness {
  private tasks: Map<string, BenchmarkTask> = new Map()

  /** Record baseline telemetry for a task */
  recordBaseline(taskId: string, telemetry: TaskTelemetry): void {
    const existing = this.tasks.get(taskId) ?? { taskId, skillId: telemetry.identity.skillId ?? 'unknown' }
    existing.baseline = telemetry
    this.tasks.set(taskId, existing)
  }

  /** Record improved (compiled) telemetry for a task */
  recordImproved(taskId: string, telemetry: TaskTelemetry): void {
    const existing = this.tasks.get(taskId) ?? { taskId, skillId: telemetry.identity.skillId ?? 'unknown' }
    existing.improved = telemetry
    this.tasks.set(taskId, existing)
  }

  /** Generate a comparison report */
  generateReport(): BenchmarkReport {
    const completedTasks = Array.from(this.tasks.values()).filter(t => t.baseline && t.improved)

    if (completedTasks.length === 0) {
      return {
        taskCount: 0,
        aggregateDiff: { contextReduction: 0, toolReduction: 0, invalidCallReduction: 0, acceptanceRateChange: 0, durationChange: 0 },
        taskDiffs: [],
        summary: 'No tasks have both baseline and improved telemetry.',
        hasImprovement: false,
      }
    }

    const taskDiffs = completedTasks.map(task => {
      const baselineRun = aggregateTelemetry([task.baseline!])
      const improvedRun = aggregateTelemetry([task.improved!])
      const diff = compareTelemetry(baselineRun, improvedRun)
      return {
        taskId: task.taskId,
        skillId: task.skillId,
        diff,
      }
    })

    const aggregateDiff = this.aggregateDiffs(taskDiffs.map(td => td.diff))

    const hasImprovement =
      aggregateDiff.contextReduction > 0 ||
      aggregateDiff.toolReduction > 0 ||
      aggregateDiff.invalidCallReduction > 0 ||
      aggregateDiff.acceptanceRateChange > 0

    const baselineRun = aggregateTelemetry(completedTasks.map(t => t.baseline!))
    const improvedRun = aggregateTelemetry(completedTasks.map(t => t.improved!))
    const summaryLines = [
      `Benchmark: ${completedTasks.length} tasks compared`,
      '',
      formatDiffReport(aggregateDiff),
      '',
      `Baseline: ${baselineRun.totalModelCalls} model calls, ${baselineRun.avgContextTokens.toFixed(0)} avg context tokens`,
      `Improved: ${improvedRun.totalModelCalls} model calls, ${improvedRun.avgContextTokens.toFixed(0)} avg context tokens`,
      '',
      hasImprovement ? 'RESULT: Compiled runtime shows measurable improvement.' : 'RESULT: No measurable improvement detected.',
    ]

    return {
      taskCount: completedTasks.length,
      aggregateDiff,
      taskDiffs,
      summary: summaryLines.join('\n'),
      hasImprovement,
    }
  }

  private aggregateDiffs(diffs: TelemetryDiff[]): TelemetryDiff {
    const n = diffs.length
    if (n === 0) return { contextReduction: 0, toolReduction: 0, invalidCallReduction: 0, acceptanceRateChange: 0, durationChange: 0 }
    return {
      contextReduction: diffs.reduce((s, d) => s + d.contextReduction, 0) / n,
      toolReduction: diffs.reduce((s, d) => s + d.toolReduction, 0) / n,
      invalidCallReduction: diffs.reduce((s, d) => s + d.invalidCallReduction, 0) / n,
      acceptanceRateChange: diffs.reduce((s, d) => s + d.acceptanceRateChange, 0) / n,
      durationChange: diffs.reduce((s, d) => s + d.durationChange, 0) / n,
    }
  }
}
