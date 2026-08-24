import { TaskCoordinator, type TaskExecutor } from './task-coordinator'
import type { WorkflowStore } from '../workflow/store'
import type { WorkerConfig } from '../workers/factory'
import type { WorkerPool } from '../workers/pool'
import { compactText } from '../output/compaction'
import { sanitizeDurableContext } from './context-envelope'

export function createWorkerPoolExecutor(pool: WorkerPool): TaskExecutor {
  return async (task, signal, control) => {
    if (!task.skillId) throw new Error(`Task ${task.taskId} has no skillId`)
    const contextCheckpoint = task.contextCheckpoints.at(-1)
    if (!contextCheckpoint) throw new Error(`Task ${task.taskId} has no context checkpoint`)
    const config: WorkerConfig = {
      skillId: task.skillId,
      task: task.objective,
      tier: task.tier as WorkerConfig['tier'],
      modelId: task.modelId,
      complexity: task.complexity,
      tokenBudget: task.budget.tokenLimit,
      context: contextCheckpoint,
    }
    const execution = await pool.executeManaged(config, {
      signal,
      onStarted: control.assignWorker,
    })
    const rawSummary = typeof execution.result?.text === 'string'
      ? execution.result.text
      : JSON.stringify(sanitizeDurableContext(execution.result ?? ''))
    return {
      workerId: execution.workerId,
      summary: compactText(rawSummary, { tokenBudget: 500, strategy: 'section-aware' }).text,
    }
  }
}

export function createWorkerTaskCoordinator(workflow: WorkflowStore, pool: WorkerPool): TaskCoordinator {
  return new TaskCoordinator(workflow, createWorkerPoolExecutor(pool))
}
