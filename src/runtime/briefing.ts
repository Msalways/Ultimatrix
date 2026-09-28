/**
 * Briefing builder (Phase D, spec 04 D2 + spec 05 EV5).
 *
 * Deterministic, relation-native digest of engagement state — pure typed
 * store reads, no LLM, no keyword logic. Two renderings from one build:
 * prose for the human (REPL start, /brief) and compact refs for the model
 * (runtime envelope already carries the machine side).
 *
 * Sections: coverage gaps, untested workflows, pending approvals, captured
 * traffic, evolution delta (what the system learned), draft skills awaiting
 * promotion.
 */

import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getGlobalWorkspace } from '../workspace'
import { getCapturedRequestStore } from '../capture/captured-request-store'
import { getEvolutionSummary } from '../intelligence/evolution'

export interface Briefing {
  prose: string
  /** Machine-readable counts backing each section (for tests/envelope). */
  stats: {
    endpoints: number
    findings: number
    tests: number
    untestedWorkflows: number
    capturedRequests: number
    evolvedTechniques: number
    draftSkills: number
    /** Rulings the operator has recorded — their knowledge, now durable. */
    humanRulings: number
    /** Claims where the two sides disagree and a human must break the tie. */
    contested: number
  }
}

function countDraftSkills(target: string | null | undefined): number {
  if (!target) return 0
  try {
    const dir = join(getGlobalWorkspace().getTargetDir(target), 'skills-drafts')
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter((name) => name.startsWith('auto-draft-')).length
  } catch {
    return 0
  }
}

interface RulingSummary {
  humanRulings: number
  contested: number
  /** Claims the operator declared normal/by-design — the knowledge a crawl cannot derive. */
  expected: string[]
  /** Claims where the two sides disagree; these are what the operator must resolve. */
  unresolved: string[]
}

function summarizeRulings(store: unknown): RulingSummary {
  const empty: RulingSummary = { humanRulings: 0, contested: 0, expected: [], unresolved: [] }
  if (!store || typeof (store as any).getDispositions !== 'function') return empty

  try {
    const dispositions = (store as any).getDispositions() as Array<{
      properties: { claimRef: string; origin: string; value: string; reason?: string; claimLabel?: string }
    }>
    if (!Array.isArray(dispositions) || dispositions.length === 0) return empty

    const humanRulings = dispositions.filter(d => d.properties.origin === 'human').length

    // Group by claim, then derive: latest-per-origin with cross-origin conflict
    // surfaced rather than resolved. Same rule the store applies to findings, so
    // the briefing and the lifecycle can never disagree with each other.
    const byClaim = new Map<string, typeof dispositions>()
    for (const d of dispositions) {
      const list = byClaim.get(d.properties.claimRef) ?? []
      list.push(d)
      byClaim.set(d.properties.claimRef, list)
    }

    const expected: string[] = []
    const unresolved: string[] = []
    for (const [claimRef, list] of byClaim) {
      const latestByOrigin = new Map<string, (typeof list)[number]>()
      for (const d of list) latestByOrigin.set(d.properties.origin, d)
      const latest = [...latestByOrigin.values()]

      if (latest.some(d => d.properties.value === 'expected')) {
        expected.push(claimRef)
        continue
      }
      const terminal = latest.filter(d =>
        d.properties.value === 'verified' || d.properties.value === 'disproven' || d.properties.value === 'rejected')
      const values = new Set(terminal.map(d => d.properties.value))
      const bothSides = terminal.some(d => d.properties.origin === 'human')
        && terminal.some(d => d.properties.origin === 'agent')
      if (bothSides && values.size > 1) unresolved.push(claimRef)
    }

    return { humanRulings, contested: unresolved.length, expected, unresolved }
  } catch {
    return empty
  }
}

export function buildBriefing(): Briefing {
  const workspace = getGlobalWorkspace()
  const store = workspace.getGraphStore()
  const summary = store?.getTargetSummary()
  const captured = getCapturedRequestStore().size
  const evolution = getEvolutionSummary()
  const drafts = countDraftSkills(workspace.getCurrentTarget())
  const rulings = summarizeRulings(store)

  const lines: string[] = []
  lines.push(`Engagement state — ${summary?.totalEndpoints ?? 0} endpoints, ${summary?.totalFindings ?? 0} findings, ${summary?.totalTests ?? 0} tests run.`)

  const untested = summary?.untestedActions ?? 0
  if (untested > 0) lines.push(`Coverage gap: ${untested} actions never tested.`)

  if (captured > 0) lines.push(`${captured} captured requests are replayable with mutations.`)

  if (evolution.techniques.length > 0) {
    const top = evolution.techniques.slice(0, 3)
      .map(t => `${t.techniqueId} (+${t.confirmed}/-${t.failed})`)
      .join(', ')
    lines.push(`Evolution this session: ${top}${evolution.promoted.length ? ` — promoted: ${evolution.promoted.join(', ')}` : ''}${evolution.demoted.length ? ` — demoted: ${evolution.demoted.join(', ')}` : ''}`)
  }

  if (drafts > 0) lines.push(`${drafts} draft skill(s) awaiting your review in skills-drafts/.`)

  // The operator's own rulings are engagement state, not chat history. Showing
  // them back is what makes the relationship visibly bidirectional: the system
  // can see that it already knows something, and can name what it still needs.
  if (rulings.expected.length > 0) {
    lines.push(`You told us these are normal/by-design — I will not re-raise them: ${rulings.expected.slice(0, 5).join(', ')}${rulings.expected.length > 5 ? ` (+${rulings.expected.length - 5} more)` : ''}.`)
  }
  if (rulings.unresolved.length > 0) {
    lines.push(`We disagree and I am not going to settle it myself: ${rulings.unresolved.slice(0, 3).join(', ')}${rulings.unresolved.length > 3 ? ` (+${rulings.unresolved.length - 3} more)` : ''}. Tell me which is right and why, and I will record it.`)
  }

  const suggested: string[] = []
  if ((summary?.totalFindings ?? 0) === 0 && (summary?.totalEndpoints ?? 0) > 0) suggested.push('no findings yet — consider param-bearing endpoints for injection/IDOR classes')
  if (captured > 0) suggested.push('replay a captured request with mutations for differential signals')
  if (drafts > 0) suggested.push('review synthesized draft skills')
  if (rulings.unresolved.length > 0) suggested.push('resolve the disagreements above — your answer is worth more than another probe')
  if (suggested.length > 0) lines.push(`Suggested next moves: ${suggested.slice(0, 2).join('; ')}.`)

  return {
    prose: lines.join('\n'),
    stats: {
      endpoints: summary?.totalEndpoints ?? 0,
      findings: summary?.totalFindings ?? 0,
      tests: summary?.totalTests ?? 0,
      untestedWorkflows: untested,
      capturedRequests: captured,
      evolvedTechniques: evolution.techniques.length,
      draftSkills: drafts,
      humanRulings: rulings.humanRulings,
      contested: rulings.contested,
    },
  }
}
