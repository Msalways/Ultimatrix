import type { TaskContextCheckpoint, TaskState } from '../workflow/types'
import { compactText } from '../output/compaction'

const MAX_REFS = 50
const MAX_DEPENDENCIES = 50
const MAX_PRIOR_ATTEMPTS = 5
const DEPENDENCY_SUMMARY_TOKENS = 250
const ATTEMPT_SUMMARY_TOKENS = 125

function boundedRefs(refs: string[]): string[] {
  return [...new Set(refs)].slice(-MAX_REFS)
}

function compactSummary(summary: string | undefined, tokenBudget: number): string | undefined {
  return summary ? compactText(summary, { tokenBudget, strategy: 'section-aware' }).text : undefined
}

/** Build a durable, bounded context snapshot without copying transcripts or raw evidence. */
export function buildTaskContextCheckpoint(
  task: TaskState,
  tasks: readonly TaskState[],
  attemptNumber: number,
  createdAt: number,
): TaskContextCheckpoint {
  const byId = new Map(tasks.map((item) => [item.taskId, item]))
  const uniqueContextRefs = [...new Set(task.contextRefs)]
  const priorAttempts = task.attemptHistory.slice(-MAX_PRIOR_ATTEMPTS)
  return {
    checkpointId: `${task.taskId}:context:${attemptNumber}`,
    createdAt,
    contextRefs: boundedRefs(uniqueContextRefs),
    ...(uniqueContextRefs.length > MAX_REFS ? { omittedContextRefs: uniqueContextRefs.length - MAX_REFS } : {}),
    dependencies: task.dependencyTaskIds.slice(0, MAX_DEPENDENCIES).map((taskId) => {
      const dependency = byId.get(taskId)
      if (!dependency) return { taskId, status: 'missing', evidenceRefs: [], graphRefs: [] }
      const evidenceRefs = [...new Set(dependency.evidenceRefs)]
      const graphRefs = [...new Set(dependency.graphRefs)]
      return {
        taskId,
        status: dependency.status,
        summary: compactSummary(dependency.resultSummary, DEPENDENCY_SUMMARY_TOKENS),
        ...(dependency.resultRef ? { resultRef: dependency.resultRef } : {}),
        evidenceRefs: boundedRefs(evidenceRefs),
        ...(evidenceRefs.length > MAX_REFS ? { omittedEvidenceRefs: evidenceRefs.length - MAX_REFS } : {}),
        graphRefs: boundedRefs(graphRefs),
        ...(graphRefs.length > MAX_REFS ? { omittedGraphRefs: graphRefs.length - MAX_REFS } : {}),
      }
    }),
    ...(task.dependencyTaskIds.length > MAX_DEPENDENCIES ? { omittedDependencies: task.dependencyTaskIds.length - MAX_DEPENDENCIES } : {}),
    priorAttempts: priorAttempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      status: attempt.status,
      summary: compactSummary(attempt.resultSummary, ATTEMPT_SUMMARY_TOKENS),
    })),
    ...(task.attemptHistory.length > MAX_PRIOR_ATTEMPTS ? { omittedPriorAttempts: task.attemptHistory.length - MAX_PRIOR_ATTEMPTS } : {}),
  }
}
