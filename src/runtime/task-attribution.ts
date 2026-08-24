import { AsyncLocalStorage } from 'node:async_hooks'
import type { WorkflowEvidenceRef } from '../workflow/types'

export interface TaskAttributionScope {
  taskId: string
  graphRefs: Set<string>
  evidence: Map<string, WorkflowEvidenceRef>
  tokenLimit?: number
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; modelCalls: number; reportedCalls: number }
  budgetExceeded: boolean
  abort?: (error: Error) => void
}

const storage = new AsyncLocalStorage<TaskAttributionScope>()

export function createTaskAttribution(taskId: string, tokenLimit?: number, abort?: (error: Error) => void): TaskAttributionScope {
  return {
    taskId, graphRefs: new Set(), evidence: new Map(), tokenLimit, abort, budgetExceeded: false,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0, reportedCalls: 0 },
  }
}

export function runWithTaskAttribution<T>(scope: TaskAttributionScope, run: () => T): T {
  return storage.run(scope, run)
}

export function attributeGraphRef(id: string): void {
  storage.getStore()?.graphRefs.add(id)
}

export function attributeEvidence(ref: WorkflowEvidenceRef): void {
  storage.getStore()?.evidence.set(ref.id, ref)
}

export function getTaskAttribution(): TaskAttributionScope | undefined {
  return storage.getStore()
}

export function beginModelCall(scope = storage.getStore()): TaskAttributionScope | undefined {
  if (!scope) return undefined
  scope.usage.modelCalls++
  return scope
}

export function reportModelUsage(
  usage: { inputTokens: number; outputTokens: number; totalTokens?: number },
  scope = storage.getStore(),
): Error | undefined {
  if (!scope) return undefined
  scope.usage.reportedCalls++
  scope.usage.inputTokens += usage.inputTokens
  scope.usage.outputTokens += usage.outputTokens
  scope.usage.totalTokens += usage.totalTokens ?? usage.inputTokens + usage.outputTokens
  if (scope.tokenLimit !== undefined && scope.usage.totalTokens >= scope.tokenLimit) {
    scope.budgetExceeded = true
    const error = new Error(`Task ${scope.taskId} reached token limit ${scope.usage.totalTokens}/${scope.tokenLimit}`)
    scope.abort?.(error)
    return error
  }
  return undefined
}

export function attributeModelCall(usage?: { inputTokens: number; outputTokens: number; totalTokens?: number }): Error | undefined {
  const scope = beginModelCall()
  return usage ? reportModelUsage(usage, scope) : undefined
}
