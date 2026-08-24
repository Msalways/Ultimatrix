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

export function buildBriefing(): Briefing {
  const workspace = getGlobalWorkspace()
  const summary = workspace.getGraphStore()?.getTargetSummary()
  const captured = getCapturedRequestStore().size
  const evolution = getEvolutionSummary()
  const drafts = countDraftSkills(workspace.getCurrentTarget())

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

  const suggested: string[] = []
  if ((summary?.totalFindings ?? 0) === 0 && (summary?.totalEndpoints ?? 0) > 0) suggested.push('no findings yet — consider param-bearing endpoints for injection/IDOR classes')
  if (captured > 0) suggested.push('replay a captured request with mutations for differential signals')
  if (drafts > 0) suggested.push('review synthesized draft skills')
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
    },
  }
}
