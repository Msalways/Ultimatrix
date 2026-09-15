import type { Blackboard } from '../core/blackboard'
import type { GraphStore } from '../graph/store'
import { compactText } from '../output/compaction'
import type { WorkflowStore } from '../workflow/store'
import { getEngagementServices } from './engagement-context'

export interface RuntimeAlert {
  type: 'stale-execution' | 'unsupported-claims'
  count: number
}

/**
 * Remediation guidance paired with each alert type (typed field, not parsed
 * from prose). The brain is told what the alert MEANS and what to do.
 */
const ALERT_GUIDANCE: Record<RuntimeAlert['type'], string> = {
  'stale-execution':
    'Recent rounds made no progress. Switch to a fundamentally different attack class and declare it with a [PATH:] tag.',
  'unsupported-claims':
    'Earlier claims lack recorded evidence. Re-verify them against captured facts or retract them before making new claims.',
}

export interface RuntimeEnvelopeInput {
  target: string
  contextWindow: number
  graph?: GraphStore
  workflow?: WorkflowStore
  blackboard?: Blackboard
  alerts?: RuntimeAlert[]
  /** Bounded recent blackboard fact strings (already sanitized by the caller). */
  blackboardFacts?: { total: number; recent: string[] }
  /** Captured-traffic awareness: how many replayable requests exist this session. */
  capturedRequests?: { total: number }
  /** Step budget: current step count, max steps, elapsed time, max duration. */
  budget?: { steps: number; maxSteps: number; elapsedMs: number; maxDurationMs: number }
}

export function runtimeEnvelopeTokenBudget(contextWindow: number): number {
  return Math.min(2000, Math.max(500, Math.floor(contextWindow * 0.02)))
}

/** A deterministic index of durable state. It contains references and counts, never payload bodies. */
export function buildRuntimeEnvelope(input: RuntimeEnvelopeInput): string {
  const services = getEngagementServices()
  const graph = input.graph ?? services?.graph
  const summary = graph?.getTargetSummary()
  const workflow = input.workflow?.state
  const tasks = workflow?.tasks ?? []
  const taskCounts = tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1
    return counts
  }, {})
  const artifacts = services?.artifacts.list().map(item => ({ id: item.id, kind: item.kind, status: item.status })) ?? []
  const pendingApprovals = [
    ...(services?.decisions.listDecisions('approval-requested').map(item => item.id) ?? []),
    ...tasks.filter(task => task.status === 'waiting').map(task => `task:${task.taskId}`),
  ]

  const index = {
    target: input.target || null,
    workflow: workflow ? {
      id: workflow.workflowId,
      status: workflow.status,
      browserProvider: workflow.browserProvider,
      browserSession: workflow.browserSessionId ? 'initialized' : 'cold',
      crawl: workflow.spider ? { pagesSeen: workflow.spider.pagesSeen, stopReason: workflow.spider.stopReason } : null,
    } : null,
    graph: summary ? {
      counts: {
        pages: summary.totalPages,
        endpoints: summary.totalEndpoints,
        findings: summary.totalFindings,
        tests: summary.totalTests,
        authFlows: summary.authFlows,
        roles: summary.rbacRoles,
      },
      refs: ['graph:Page', 'graph:Endpoint', 'graph:Finding', 'graph:Test', 'graph:AuthFlow'],
    } : null,
    tasks: { counts: taskCounts, refs: tasks.slice(-20).map(task => task.taskId) },
    approvals: { unresolved: pendingApprovals },
    plan: input.blackboard ? { counts: input.blackboard.planCounts(), refs: input.blackboard.plan.slice(-20).map(item => item.id) } : null,
    facts: input.blackboardFacts
      ? { total: input.blackboardFacts.total, recent: input.blackboardFacts.recent }
      : null,
    capture: input.capturedRequests
      ? {
          total: input.capturedRequests.total,
          note: 'captured requests are listable and replayable with structural mutations (headers/body/url/method)',
        }
      : null,
    artifacts,
    alerts: (input.alerts ?? []).map(alert => ({ ...alert, guidance: ALERT_GUIDANCE[alert.type] })),
    budget: input.budget ? {
      steps: input.budget.steps,
      maxSteps: input.budget.maxSteps,
      remainingSteps: input.budget.maxSteps - input.budget.steps,
      elapsedSec: Math.round(input.budget.elapsedMs / 1000),
      remainingSec: Math.round((input.budget.maxDurationMs - input.budget.elapsedMs) / 1000),
      percentUsed: Math.round((input.budget.steps / input.budget.maxSteps) * 100),
    } : null,
  }

  const budget = runtimeEnvelopeTokenBudget(input.contextWindow)
  return `\n\n<runtime-index>\n${compactText(JSON.stringify(index), { tokenBudget: budget, strategy: 'section-aware' }).text}\n</runtime-index>`
}

/** Used by durable summaries before storage or observation. */
export function sanitizeDurableContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDurableContext)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, '')
    if (normalized.includes('reasoning') || normalized.includes('secret') || normalized === 'requestbody' || normalized === 'responsebody' || normalized === 'tooloutput') continue
    output[key] = sanitizeDurableContext(item)
  }
  return output
}
