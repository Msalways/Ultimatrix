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
import { NodeType } from '../graph/schema'
import { getEngagementServices } from './engagement-context'
import { redactUrl } from '../security/secret-vault'

function publicNodeContext(node: any): Record<string, unknown> {
  const properties = node.properties ?? {}
  if (node.type === NodeType.ENDPOINT) {
    return {
      id: node.id, type: node.type, label: node.label,
      url: safeRouteUrl(properties.url), method: properties.method,
      inputs: properties.params ?? [], authRequired: properties.authRequired,
      authType: properties.authType, useCase: properties.useCase, tags: properties.tags,
    }
  }
  if (node.type === NodeType.WORKFLOW) {
    return {
      id: node.id, type: node.type, label: node.label,
      name: properties.name, entryUrl: safeRouteUrl(properties.entryUrl),
      steps: (properties.steps ?? []).map((step: any) => ({ ...step, url: safeRouteUrl(step.url) })),
      relatedEndpoints: properties.relatedEndpoints, inputFields: properties.inputFields,
      stateChanges: properties.stateChanges, observedRoles: properties.observedRoles,
      capturedRequestIds: properties.capturedRequestIds, source: properties.source,
    }
  }
  return { id: node.id, type: node.type, label: node.label }
}

function safeRouteUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(redactUrl(value)); return `${url.origin}${url.pathname}` } catch { return undefined }
}

function getNode(graph: any, ref: string): any {
  return graph?.getNode?.(ref) ?? graph?.queryNodes?.().find((node: any) => node.id === ref)
}

function buildWorkerContext(task: any, checkpoint: any, graph: any): { packet: Record<string, unknown>; missingRefs: string[] } {
  const refs = [...new Set([
    ...(task.contextRefs ?? []),
    ...(checkpoint.contextRefs ?? []),
    ...(checkpoint.dependencies ?? []).flatMap((dependency: any) => dependency.graphRefs ?? []),
  ])]
  const nodes = refs.map(ref => getNode(graph, ref)).filter(Boolean)
  const missingRefs = refs.filter(ref => !getNode(graph, ref))
  if (checkpoint.omittedContextRefs) missingRefs.push(`${checkpoint.omittedContextRefs} context reference(s) omitted from checkpoint`)
  if (checkpoint.omittedDependencies) missingRefs.push(`${checkpoint.omittedDependencies} prerequisite(s) omitted from checkpoint`)
  for (const dependency of checkpoint.dependencies ?? []) {
    if (dependency.omittedEvidenceRefs) missingRefs.push(`${dependency.omittedEvidenceRefs} evidence reference(s) omitted for prerequisite ${dependency.taskId}`)
    if (dependency.omittedGraphRefs) missingRefs.push(`${dependency.omittedGraphRefs} graph reference(s) omitted for prerequisite ${dependency.taskId}`)
  }
  const endpointIds = new Set(nodes.filter((node: any) => node.type === NodeType.ENDPOINT).map((node: any) => node.id))
  const workflows = (graph?.queryNodes?.(NodeType.WORKFLOW) ?? [])
    .filter((node: any) => (node.properties.relatedEndpoints ?? []).some((id: string) => endpointIds.has(id)))
  const evidenceRefs = [...new Set([
    ...(task.evidenceRefs ?? []),
    ...(checkpoint.dependencies ?? []).flatMap((dependency: any) => dependency.evidenceRefs ?? []),
  ])]
  if (task.kind && refs.length === 0 && evidenceRefs.length === 0) missingRefs.push('research task has no observed graph or evidence reference')
  return {
    packet: {
      taskId: task.taskId,
      objective: task.objective,
      taskKind: task.kind,
      resourceClaims: task.resourceClaims ?? [],
      skillId: task.skillId,
      contextRefs: refs,
      graph: [...nodes, ...workflows].map(publicNodeContext),
      evidenceRefs,
      prerequisites: checkpoint.dependencies,
      priorAttempts: checkpoint.priorAttempts,
      omittedPriorAttempts: checkpoint.omittedPriorAttempts ?? 0,
    },
    missingRefs,
  }
}

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
    const graph = getEngagementServices()?.graph ?? getGlobalGraphStoreIfInitialized()
    const { packet, missingRefs } = buildWorkerContext(task, contextCheckpoint, graph)
    if (missingRefs.length > 0) {
      return { status: 'blocked', summary: `Task blocked: required context reference(s) are missing: ${missingRefs.join(', ')}` }
    }
    const config: WorkerConfig = {
      skillId: task.skillId,
      task: task.objective,
      tier: task.tier as WorkerConfig['tier'],
      modelId: task.modelId,
      complexity: task.complexity,
      tokenBudget: task.budget.tokenLimit,
      context: packet,
    }
    const contextFit = pool.validateWorkerContext?.(config, task.modelId ?? '')
    if (contextFit && !contextFit.fits) {
      return {
        status: 'blocked',
        summary: `Task blocked: required context does not fit or cannot be validated for model ${task.modelId ?? 'selected worker model'}: ${contextFit.reason ?? `${contextFit.totalInputTokens} input tokens plus reserved output exceeds the available context.`}`,
      }
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
    if (graph) {
      try {
        const sanitizedInput = sanitizeDurableContext(execution.result ?? null)
        const ref = new ToolResultStore(graph).store(`worker:${execution.workerId}`, sanitizedInput, {
          taskId: task.taskId,
          skillId: task.skillId,
        })
        resultRef = ref.graphNodeId
      } catch {
        /* store is advisory */
      }
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

function getGlobalGraphStoreIfInitialized(): ReturnType<typeof getGlobalGraphStore> | undefined {
  try { return getGlobalGraphStore() } catch { return undefined }
}

export function createWorkerTaskCoordinator(workflow: WorkflowStore, pool: WorkerPool): TaskCoordinator {
  return new TaskCoordinator(workflow, createWorkerPoolExecutor(pool))
}
