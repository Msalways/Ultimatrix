import { describe, expect, it } from 'vitest'
import { buildTaskContextCheckpoint } from '../../src/runtime/task-context'
import type { TaskState } from '../../src/workflow/types'

function task(overrides: Partial<TaskState> = {}): TaskState {
  return {
    taskId: 'task', objective: 'objective', dependencyTaskIds: [], contextRefs: [], requiredCapabilities: [],
    acceptanceCriteria: [], acceptanceResults: [], budget: {}, retryPolicy: { maxAttempts: 1, retryOn: [], backoffMs: 0 },
    status: 'planned', attempts: 0, attemptHistory: [], evidenceRefs: [], graphRefs: [], contextCheckpoints: [],
    createdAt: 1, updatedAt: 1, ...overrides,
  }
}

describe('task context checkpoints', () => {
  it('bounds refs, summaries, dependencies, and attempt history without raw evidence', () => {
    const dependencies = Array.from({ length: 60 }, (_, index) => task({
      taskId: `dep-${index}`, status: 'completed', resultSummary: 'x'.repeat(2000),
      evidenceRefs: Array.from({ length: 80 }, (__, ref) => `e-${index}-${ref}`),
      graphRefs: Array.from({ length: 80 }, (__, ref) => `g-${index}-${ref}`),
    }))
    const subject = task({
      dependencyTaskIds: dependencies.map((dependency) => dependency.taskId),
      contextRefs: Array.from({ length: 80 }, (_, index) => `context-${index}`),
      attemptHistory: Array.from({ length: 8 }, (_, index) => ({
        attemptId: `attempt-${index}`, number: index + 1, status: 'failed', resultSummary: 'y'.repeat(1000), evidenceRefs: [], graphRefs: [],
      })),
    })

    const checkpoint = buildTaskContextCheckpoint(subject, [subject, ...dependencies], 9, 10)

    expect(checkpoint.contextRefs).toHaveLength(50)
    expect(checkpoint.dependencies).toHaveLength(50)
    expect(checkpoint.dependencies[0].summary!.length).toBeLessThan(2000)
    expect(checkpoint.dependencies[0].evidenceRefs).toHaveLength(50)
    expect(checkpoint.priorAttempts).toHaveLength(5)
    expect(checkpoint.priorAttempts[0].summary!.length).toBeLessThan(1000)
    expect(JSON.stringify(checkpoint)).not.toContain('rawEvidence')
  })
})
