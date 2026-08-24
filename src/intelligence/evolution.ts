/**
 * Self-Evolution Recorder (Phase D, spec 05).
 *
 * The deterministic half of the learning loop: typed seams call these
 * functions; they update the TechniqueRegistry runtime overrides so evolved
 * weights immediately reorder planner/primitive selection, keep session-level
 * counters, and expose a typed summary for briefing/visibility.
 *
 * The reflective half (distilled lessons) lives at engagement finalization:
 * finalizeEngagementMemory folds the run into anonymized cross-engagement
 * memory whose promptBlock reaches future turns.
 */

import { getTechniqueRegistry } from '../skills/technique-registry'

export interface EvolutionCounters {
  confirmed: number
  failed: number
}

export interface EvolutionSummary {
  /** techniqueId → session counters, sorted by net score descending. */
  techniques: Array<{ techniqueId: string } & EvolutionCounters>
  /** Techniques with a positive evolved weight delta this session. */
  promoted: string[]
  /** Techniques with a negative evolved weight delta this session. */
  demoted: string[]
}

const counters = new Map<string, EvolutionCounters>()

function bump(techniqueId: string, field: keyof EvolutionCounters): void {
  if (!techniqueId || typeof techniqueId !== 'string') return
  const key = techniqueId.trim()
  if (!key) return
  const entry = counters.get(key) ?? { confirmed: 0, failed: 0 }
  entry[field] += 1
  counters.set(key, entry)
}

/**
 * A technique produced a CONFIRMED, committed finding. Boosts its runtime
 * weight via the registry's outcome-override path (accepted += 1).
 */
export function recordTechniqueConfirmed(techniqueId: string): void {
  bump(techniqueId, 'confirmed')
  try {
    const reg = getTechniqueRegistry()
    reg.recordTechniqueOutcome(techniqueId, { accepted: true })
  } catch {
    /* evolution must never break the finding path */
  }
}

/**
 * A technique attempt FAILED (unconfirmed primitive oracle, errored attack
 * tool with an identified vuln type). Dampens its runtime weight.
 */
export function recordTechniqueFailed(techniqueId: string): void {
  bump(techniqueId, 'failed')
  try {
    const reg = getTechniqueRegistry()
    // A single failure is noise; dampen on repeated failures of the same class.
    const c = counters.get(techniqueId.trim())
    const failures = c?.failed ?? 0
    if (failures > 0 && failures % 3 === 0) {
      reg.recordTechniqueOutcome(techniqueId, { regression: true })
    }
  } catch {
    /* never break the failure path */
  }
}

/** Typed session summary for briefing / /learned visibility. */
export function getEvolutionSummary(): EvolutionSummary {
  const techniques = [...counters.entries()]
    .map(([techniqueId, c]) => ({ techniqueId, ...c }))
    .sort((a, b) => (b.confirmed - b.failed) - (a.confirmed - a.failed))

  const reg = getTechniqueRegistry()
  const promoted: string[] = []
  const demoted: string[] = []
  for (const t of techniques) {
    const weight = reg.getTechniqueWeight(t.techniqueId)
    if (weight > 1.0) promoted.push(t.techniqueId)
    else if (weight < 1.0) demoted.push(t.techniqueId)
  }
  return { techniques, promoted, demoted }
}

/** Test/reset seam. */
export function resetEvolution(): void {
  counters.clear()
}
