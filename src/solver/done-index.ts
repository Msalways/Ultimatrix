/**
 * Done Index — Compact "what's been tested/untested" summary.
 *
 * Replaces unbounded blackboard/reflexion/cross-engagement prompt blocks
 * with a single ~200-500 token summary. Prevents re-testing by showing
 * exactly what's been covered and what remains.
 */

import type { GraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { Blackboard } from '../core/blackboard'

/** Rough char-to-token estimate. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Build a compact done index from the current graph state + blackboard.
 *
 * Output format (~200-500 tokens):
 * ```
 * Tested Endpoints:
 * - GET /api/users → sqli, xss, idor
 * - POST /api/login → brute-force, credential-stuffing
 *
 * Untested (3): PUT /api/users/:id; DELETE /api/users/:id; GET /api/admin
 *
 * Failed: timing-attack inconclusive; ssti blocked by WAF
 *
 * Attack Paths: / → /api/admin (2 hops, high severity)
 * ```
 *
 * @param graph - Graph store for querying nodes
 * @param blackboard - Blackboard for plan/task state
 * @param tokenBudget - Max tokens for the index (default 500)
 * @returns Compact done-index string
 */
export function buildDoneIndex(
  graph: GraphStore,
  blackboard: Blackboard,
  tokenBudget: number = 500,
): string {
  const lines: string[] = []

  // ─── Tested endpoints ──────────────────────────────────────
  const findings = graph.queryNodes(NodeType.FINDING) as any[]
  const endpoints = graph.queryNodes(NodeType.ENDPOINT) as any[]
  const tests = graph.queryNodes(NodeType.TEST) as any[]

  // Group findings by endpoint
  const testedByEndpoint = new Map<string, Set<string>>()
  for (const f of findings) {
    const ep = f.properties?.endpoint || '(unknown)'
    const tech = f.properties?.technique || 'unknown'
    if (!testedByEndpoint.has(ep)) testedByEndpoint.set(ep, new Set())
    testedByEndpoint.get(ep)!.add(tech)
  }

  if (testedByEndpoint.size > 0) {
    lines.push('Tested Endpoints:')
    for (const [ep, techniques] of testedByEndpoint) {
      lines.push(`- ${ep} → ${[...techniques].join(', ')}`)
    }
  }

  // ─── Untested endpoints ────────────────────────────────────
  const untested = endpoints.filter(ep => !testedByEndpoint.has(ep.properties?.url || ''))
  if (untested.length > 0) {
    const epList = untested.slice(0, 10).map((ep: any) =>
      `${ep.properties?.method || 'GET'} ${ep.properties?.url || '?'}`
    ).join('; ')
    const more = untested.length > 10 ? ` +${untested.length - 10} more` : ''
    lines.push(`\nUntested (${untested.length}): ${epList}${more}`)
  }

  // ─── Failed approaches ─────────────────────────────────────
  const reflexions = graph.queryNodes(NodeType.REFLEXION) as any[]
  if (reflexions.length > 0) {
    const failed = reflexions.slice(-5).map((r: any) => {
      const tech = r.properties?.vulnType || '?'
      const reason = r.properties?.failureCategory || 'unknown'
      return `${tech} (${reason})`
    })
    lines.push(`\nFailed: ${failed.join('; ')}`)
  }

  // ─── Plan progress ─────────────────────────────────────────
  const planSummary = blackboard.getSummary() as any
  if (planSummary.planTotal > 0) {
    const counts = (planSummary.planCounts || {}) as Record<string, number>
    const done = (counts.done || 0) + (counts.skip || 0)
    lines.push(`\nPlan: ${done}/${planSummary.planTotal} tasks completed`)
  }

  // ─── Attack paths ──────────────────────────────────────────
  const attacks = graph.queryNodes(NodeType.ATTACK) as any[]
  if (attacks.length > 0) {
    const paths = attacks.slice(-3).map((a: any) => {
      const tech = a.properties?.technique || '?'
      const vuln = a.properties?.vulnerable ? 'VULN' : 'safe'
      return `${tech} [${vuln}]`
    })
    lines.push(`\nAttacks: ${paths.join('; ')}`)
  }

  const result = lines.join('\n')

  // Enforce token budget
  const tokens = estimateTokens(result)
  if (tokens > tokenBudget) {
    return result.slice(0, tokenBudget * 4) + '\n... [done index truncated]'
  }

  return result
}
