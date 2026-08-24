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
  return {
    checkpointId: `${task.taskId}:context:${attemptNumber}`,
    createdAt,
    contextRefs: boundedRefs(task.contextRefs),
    dependencies: task.dependencyTaskIds.slice(0, MAX_DEPENDENCIES).map((taskId) => {
      const dependency = byId.get(taskId)
      return dependency
        ? {
            taskId,
            status: dependency.status,
            summary: compactSummary(dependency.resultSummary, DEPENDENCY_SUMMARY_TOKENS),
            evidenceRefs: boundedRefs(dependency.evidenceRefs),
            graphRefs: boundedRefs(dependency.graphRefs),
          }
        : { taskId, status: 'missing', evidenceRefs: [], graphRefs: [] }
    }),
    priorAttempts: task.attemptHistory.slice(-MAX_PRIOR_ATTEMPTS).map((attempt) => ({
      attemptId: attempt.attemptId,
      status: attempt.status,
      summary: compactSummary(attempt.resultSummary, ATTEMPT_SUMMARY_TOKENS),
    })),
  }
}
