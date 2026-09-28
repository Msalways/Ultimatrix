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
  /** G10: Techniques validated by prior client feedback (remediation held on retest). */
  validatedTechniques?: string[]
  /** G10: Technique weight overrides from prior sessions. */
  techniqueWeights?: Array<{ techniqueId: string; weight: number; confidence: number }>
}

/** Cap on rendered reasons so a long operator ruling cannot crowd out the index. */
const RULING_REASON_MAX = 160
const RULING_LIST_MAX = 12

/**
 * Project the disposition log into the model-facing shape.
 *
 * Reasons are included (truncated) on purpose: "this is normal because invoices
 * are shared between tenants" IS the knowledge a crawl cannot derive, and
 * referring to it without the reason is worse than not mentioning it. Payloads
 * are still never included — only human/agent reasoning.
 */
function indexRulings(graph: GraphStore | undefined) {
  if (!graph || typeof (graph as unknown as { getDispositions?: unknown }).getDispositions !== 'function') return null
  try {
    type Rule = {
      createdAt: number
      properties: { claimRef: string; origin: string; value: string; reason?: string; claimLabel?: string }
    }
    const dispositions = graph.getDispositions() as Rule[]

    const claimOf = (d: Rule) => d.properties.claimLabel || d.properties.claimRef
    const brief = (d: Rule) => ({
      claim: claimOf(d),
      by: d.properties.origin,
      reason: (d.properties.reason ?? '').slice(0, RULING_REASON_MAX),
    })

    const expected = dispositions.filter(d => d.properties.value === 'expected').slice(-RULING_LIST_MAX).map(brief)
    const rejected = dispositions.filter(d => d.properties.value === 'rejected').slice(-RULING_LIST_MAX).map(brief)

    // Latest-per-origin per claim, then flag cross-origin terminal conflict.
    const byClaim = new Map<string, Rule[]>()
    for (const d of dispositions) {
      const list = byClaim.get(d.properties.claimRef) ?? []
      list.push(d)
      byClaim.set(d.properties.claimRef, list)
    }
    const contested: string[] = []
    for (const list of byClaim.values()) {
      const latestByOrigin = new Map<string, Rule>()
      for (const d of list) latestByOrigin.set(d.properties.origin, d)
      const terminal = [...latestByOrigin.values()].filter(d =>
        d.properties.value === 'verified' || d.properties.value === 'disproven' || d.properties.value === 'rejected')
      if (
        terminal.some(d => d.properties.origin === 'human')
        && terminal.some(d => d.properties.origin === 'agent')
        && new Set(terminal.map(d => d.properties.value)).size > 1
      ) contested.push(claimOf(list[list.length - 1]))
    }

    // Show what has NOT been ruled on.
    //
    // This is the direct counter to a verified live failure: the model told the
    // operator that an unruled finding "falls under your general ruling" — a
    // ruling that did not exist, invented to be agreeable. It did that because
    // the index only ever showed what HAD been ruled, so coverage had to be
    // inferred from absence, and absence is exactly what a language model fills
    // in. Making the open claims explicit turns an inference into a lookup.
    const ruledRefs = new Set(dispositions.map(d => d.properties.claimRef))
    const unruled: string[] = []
    if (typeof (graph as unknown as { queryNodes?: unknown }).queryNodes === 'function') {
      const findings = graph.queryNodes('Finding' as never) as Array<{
        id: string
        properties: { findingId?: string; endpoint?: string; technique?: string }
      }>
      for (const f of findings) {
        const key = f.properties.findingId ?? f.id
        if (ruledRefs.has(key)) continue
        const label = `${f.properties.technique ?? 'finding'} @ ${f.properties.endpoint ?? 'unknown'}`
        if (!unruled.includes(label)) unruled.push(label)
      }
    }

    return {
      expectedByOperator: expected.length ? expected : null,
      rejectedByOperator: rejected.length ? rejected : null,
      contested: contested.length ? contested : null,
      // The count is authoritative; the list is a bounded sample. Reporting only
      // the sample lets the model read a truncated list as the complete set and
      // conclude that everything not shown must be covered by a general ruling —
      // the exact confabulation the `unruled` list exists to prevent.
      unruledCount: unruled.length,
      unruled: unruled.length ? unruled.slice(-RULING_LIST_MAX) : null,
      note: 'A claim is ruled ONLY if it appears in expectedByOperator or rejectedByOperator. Anything in `unruled` has NO ruling on record — never assume a general or standing ruling covers it, and never describe one as existing. `unruled` is the most recent entries: trust unruledCount over the list length. Do not re-propose expected/rejected claims without new evidence. `contested` means the two sides disagree: surface it and ask, do not resolve it yourself. If the operator states or extends a ruling, record it with the disposition tool — agreeing in words does not record anything. If YOU reach a different verdict than the operator on a claim they have already ruled, record it with origin=agent and your own value: that is what puts the claim in `contested` so the disagreement becomes visible. Analysing a disagreement in prose while leaving the log one-sided is the same failure as inventing a ruling — both hide it where nobody can see it.',
    }
  } catch {
    return null
  }
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
    // G10: Battle-tested technique data from prior sessions
    validatedTechniques: input.validatedTechniques?.length
      ? input.validatedTechniques
      : null,
    techniqueWeights: input.techniqueWeights?.length
      ? input.techniqueWeights
      : null,
    // Rulings the operator has already made. Without these the model re-derives
    // claims the operator has already settled, which is the one failure this
    // whole mechanism exists to prevent.
    rulings: indexRulings(graph),
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
