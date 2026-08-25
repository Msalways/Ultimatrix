import { TaskCoordinator, type TaskExecutor } from './task-coordinator'
import type { WorkflowStore } from '../workflow/store'
import type { WorkerConfig } from '../workers/factory'
import type { WorkerPool } from '../workers/pool'
import { compactText } from '../output/compaction'
import { sanitizeDurableContext } from './context-envelope'
import { bridgeWorkerEvidence, type WorkerToolCall } from '../council/evidence-bridge'
import { coreEvidenceLedger } from '../core/evidence'
import { getGlobalGraphStore } from '../graph/store'
import { ToolResultStore } from '../graph/tool-result-store'

/**
 * F3 (Base Architecture Contracts) â€” typed envelope for worker execution.
 * The ONLY shape that crosses the agent boundary: compact summary upward,
 * full result persisted behind a ref, tool calls represented in the ledger.
 */
export interface WorkerExecutionEnvelope {
  workerId: string
  summary: string
  /** Evidence items recorded from the worker's tool calls (I3). */
  evidenceRecorded: number
  /** ToolResultStore graph node id â€” full sanitized result readable via getToolResult. */
  resultRef?: string
}

/** Extract Mastra tool results defensively across known result shapes. */
function extractToolResults(result: unknown): Array<{ name: string; result: unknown }> {
  if (!result || typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  const map = (arr: unknown): Array<{ name: string; result: unknown }> =>
    Array.isArray(arr)
      ? arr.map((tr: any) => ({ name: String(tr?.name ?? 'unknown'), result: tr?.result }))
      : []
  if (Array.isArray(r.toolResults)) return map(r.toolResults)
  if (Array.isArray(r.steps)) {
    return (r.steps as unknown[]).flatMap((step) => map((step as any)?.toolResults))
  }
  return []
}

const MAX_BRIDGED_PER_WORKER = 25

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

    // F3/I3 â€” worker toolCalls become structured evidence. Previously only
    // result.text was read and the entire tool-call record was dropped.
    let evidenceRecorded = 0
    try {
      const toolCalls: WorkerToolCall[] = extractToolResults(execution.result)
        .slice(0, MAX_BRIDGED_PER_WORKER)
        .map(tr => ({ toolName: tr.name, args: undefined, result: tr.result }))
      evidenceRecorded = bridgeWorkerEvidence(toolCalls, coreEvidenceLedger)
    } catch {
      /* bridging must never fail the task */
    }

    // F3 â€” persist the full sanitized result; the brain can read it back via
    // getToolResult(resultRef).
    let resultRef: string | undefined
    try {
      const { getEngagementServices } = await import('./engagement-context')
      const graph = getEngagementServices()?.graph ?? getGlobalGraphStore()
      const sanitizedInput = sanitizeDurableContext(execution.result ?? null)
      const ref = new ToolResultStore(graph).store(`worker:${execution.workerId}`, sanitizedInput, {
        taskId: task.taskId,
        skillId: task.skillId,
      })
      resultRef = ref.graphNodeId
    } catch {
      /* store is advisory */
    }

    const rawSummary = typeof execution.result?.text === 'string'
      ? execution.result.text
      : JSON.stringify(sanitizeDurableContext(execution.result ?? ''))
    const summary = compactText(rawSummary, { tokenBudget: 500, strategy: 'section-aware' }).text

    return {
      workerId: execution.workerId,
      summary,
      evidenceRecorded,
      ...(resultRef ? { resultRef } : {}),
    }
  }
}

export function createWorkerTaskCoordinator(workflow: WorkflowStore, pool: WorkerPool): TaskCoordinator {
  return new TaskCoordinator(workflow, createWorkerPoolExecutor(pool))
}
