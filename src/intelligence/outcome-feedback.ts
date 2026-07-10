/**
 * Outcome-Feedback Loop — closes the post-engagement loop.
 *
 * The ReflexionEngine only reacts to in-run attack-strategy failures. This
 * module captures what happened AFTER the report was delivered:
 *   - Was the reported finding accepted by the client?
 *   - Did the remediation hold on retest? (regression = failure)
 *
 * That signal is fed back into the TechniqueRegistry as a runtime-only
 * override (the static base config is never mutated) so the planner/selector
 * can weight techniques by real-world effectiveness, and persisted to the
 * knowledge graph scoped by targetOrigin for privacy.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { Severity } from '../types/shared'
import { getTechniqueRegistry } from '../skills/technique-registry'
import { getGlobalWorkspace } from '../workspace'
import { saveOutcomeFeedback } from './reflexion-store'

export interface OutcomeInput {
  accepted?: boolean
  fixed?: boolean
  retestHeld?: boolean
  severityAdjusted?: Severity
  note?: string
}

export interface FindingOutcome extends OutcomeInput {
  findingId: string
  techniqueId: string
  targetOrigin?: string
  timestamp: string
}

export interface TechniqueEffectiveness {
  techniqueId: string
  attempts: number
  acceptedRate: number
  fixHoldRate: number
  regressionCount: number
  validated: boolean
}

function deriveOrigin(target: string | null): string | undefined {
  if (!target) return undefined
  try {
    return new URL(target).host || undefined
  } catch {
    return target
  }
}

function recomputeStats(
  outcomes: Map<string, FindingOutcome>,
): Record<string, TechniqueEffectiveness> {
  const byTechnique = new Map<string, {
    attempts: number
    accepted: number
    fixHeld: number
    regression: number
    validated: boolean
  }>()

  for (const o of outcomes.values()) {
    const t = o.techniqueId
    const agg = byTechnique.get(t) || { attempts: 0, accepted: 0, fixHeld: 0, regression: 0, validated: false }
    agg.attempts++
    if (o.accepted) agg.accepted++
    if (o.retestHeld) {
      agg.fixHeld++
      agg.validated = true
    }
    if (o.accepted === false || o.fixed === false) agg.regression++
    byTechnique.set(t, agg)
  }

  const result: Record<string, TechniqueEffectiveness> = {}
  for (const [techniqueId, agg] of byTechnique) {
    result[techniqueId] = {
      techniqueId,
      attempts: agg.attempts,
      acceptedRate: agg.attempts ? agg.accepted / agg.attempts : 0,
      fixHoldRate: agg.attempts ? agg.fixHeld / agg.attempts : 0,
      regressionCount: agg.regression,
      validated: agg.validated,
    }
  }
  return result
}

export class OutcomeFeedbackStore {
  private outcomes: Map<string, FindingOutcome> = new Map()

  /**
   * Record whether a reported finding was accepted by the client and whether
   * the remediation held on retest. Updates aggregated technique effectiveness
   * and the TechniqueRegistry runtime override.
   */
  recordOutcome(
    findingId: string,
    techniqueId: string,
    outcome: OutcomeInput,
    targetOrigin?: string,
  ): FindingOutcome {
    const origin = targetOrigin ?? deriveOrigin(getGlobalWorkspace().getCurrentTarget())
    const record: FindingOutcome = {
      findingId,
      techniqueId,
      ...outcome,
      targetOrigin: origin,
      timestamp: new Date().toISOString(),
    }
    this.outcomes.set(findingId, record)
    this.syncToRegistry()
    saveOutcomeFeedback([record], origin)
    return record
  }

  /**
   * Re-ingest a previously persisted outcome (e.g. loaded from the graph).
   * Rebuilds technique effectiveness and registry overrides from the full
   * outcome set so nothing is double-counted.
   */
  ingestOutcomeFeedback(outcome: FindingOutcome): void {
    this.outcomes.set(outcome.findingId, outcome)
    this.syncToRegistry()
  }

  /** Bulk ingest (used when restoring persisted feedback for a target). */
  ingestAll(outcomes: FindingOutcome[]): void {
    for (const o of outcomes) this.outcomes.set(o.findingId, o)
    this.syncToRegistry()
  }

  getOutcome(findingId: string): FindingOutcome | undefined {
    return this.outcomes.get(findingId)
  }

  getAllOutcomes(): FindingOutcome[] {
    return [...this.outcomes.values()]
  }

  /** Aggregate outcome stats per technique. */
  getTechniqueEffectiveness(): Record<string, TechniqueEffectiveness> {
    return recomputeStats(this.outcomes)
  }

  private syncToRegistry(): void {
    const reg = getTechniqueRegistry()
    const stats = recomputeStats(this.outcomes)
    for (const [techniqueId, stat] of Object.entries(stats)) {
      reg.setTechniqueOutcomeStats(techniqueId, {
        acceptedCount: stat.acceptedRate > 0 ? 1 : 0,
        fixHoldCount: stat.validated ? 1 : 0,
        regressionCount: stat.regressionCount,
      })
    }
  }
}

let _outcomeStore: OutcomeFeedbackStore | null = null

export function getOutcomeFeedbackStore(): OutcomeFeedbackStore {
  if (!_outcomeStore) _outcomeStore = new OutcomeFeedbackStore()
  return _outcomeStore
}

export function resetOutcomeFeedbackStore(): void {
  _outcomeStore = null
}

/**
 * Mastra tool: lets the solver record client feedback on a reported finding
 * (accepted? fix held on retest?). Feeds the outcome-feedback loop.
 */
export const recordOutcomeTool = createTool({
  id: 'recordOutcome',
  description: 'Record post-engagement client feedback for a reported finding: was it accepted, and did the remediation hold on retest? Updates technique effectiveness weights.',
  inputSchema: z.object({
    findingId: z.string().describe('ID of the reported finding (e.g. "finding:<endpoint>:<technique>")'),
    techniqueId: z.string().describe('Technique used for the finding (e.g. "SQL Injection", "XSS")'),
    accepted: z.boolean().optional().describe('Whether the client accepted the finding as valid'),
    fixed: z.boolean().optional().describe('Whether the client indicated the issue is fixed'),
    retestHeld: z.boolean().optional().describe('Whether the remediation held on a later retest (true = validated, false = regression)'),
    severityAdjusted: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional().describe('Severity the client assigned, if different from reported'),
    note: z.string().optional().describe('Free-text client note'),
    targetOrigin: z.string().optional().describe('Target origin (host) for scoping; auto-derived from current target if omitted'),
  }),
  execute: async ({ findingId, techniqueId, accepted, fixed, retestHeld, severityAdjusted, note, targetOrigin }) => {
    const store = getOutcomeFeedbackStore()
    const record = store.recordOutcome(
      findingId,
      techniqueId,
      { accepted, fixed, retestHeld, severityAdjusted, note },
      targetOrigin,
    )
    const effectiveness = store.getTechniqueEffectiveness()[techniqueId]
    return {
      ok: true,
      value: {
        recorded: record,
        techniqueEffectiveness: effectiveness ?? null,
        techniqueWeight: getTechniqueRegistry().getTechniqueWeight(techniqueId),
      },
    }
  },
})
