/**
 * Pivot Generator (Phase 5).
 *
 * Converts investigation conclusions into new research opportunities.
 * Safety rule: IDEA GENERATION ≠ AUTHORIZATION.
 * Pivots become opportunities — they never bypass policy, skill selection,
 * or capability compilation.
 */

import type { ResearchCase } from '../cases/types'
import type { ResearchOpportunity } from '../opportunities/types'
import { createOrUpdate } from '../opportunities/store'

/** A proposed pivot from an investigation conclusion */
export interface ProposedPivot {
  title: string
  hypothesis: string
  sourceRefs: string[]
  suggestedSkills: string[]
  expectedInformationGain?: number
  estimatedCost?: number
}

/**
 * Generate pivots from a research case conclusion.
 *
 * When an investigation is rejected (false positive), the pivot generator
 * suggests alternative investigation directions based on what was learned.
 *
 * Pivots are NEVER automatically executed — they become ResearchOpportunities
 * that must go through normal policy and capability compilation.
 */
export function generatePivots(
  caseData: ResearchCase,
  opts: {
    /** Additional context from the investigation */
    relatedEndpoints?: string[]
    /** Skills that might be relevant to the pivots */
    availableSkills?: string[]
  } = {},
): ProposedPivot[] {
  const pivots: ProposedPivot[] = []

  // If hypothesis was rejected, suggest alternatives
  if (caseData.outcome === 'rejected') {
    // Pivot 1: Test adjacent endpoints
    if (opts.relatedEndpoints && opts.relatedEndpoints.length > 0) {
      pivots.push({
        title: 'Test adjacent endpoints',
        hypothesis: `Similar pattern may exist on related endpoints: ${opts.relatedEndpoints.slice(0, 3).join(', ')}`,
        sourceRefs: caseData.sourceRefs,
        suggestedSkills: opts.availableSkills ?? [caseData.skillId].filter(Boolean) as string[],
        expectedInformationGain: 0.4,
        estimatedCost: 0.3,
      })
    }

    // Pivot 2: Try different technique for same hypothesis
    if (caseData.falsePositiveReason) {
      pivots.push({
        title: 'Alternative technique',
        hypothesis: `Original technique failed: ${caseData.falsePositiveReason}. Try a different approach to the same hypothesis.`,
        sourceRefs: caseData.sourceRefs,
        suggestedSkills: opts.availableSkills ?? [],
        expectedInformationGain: 0.5,
        estimatedCost: 0.4,
      })
    }

    // Pivot 3: Expand scope
    if (caseData.contextFeatures.length > 0) {
      pivots.push({
        title: 'Expand investigation scope',
        hypothesis: `Narrow scope may have missed related vulnerability class. Expand from: ${caseData.contextFeatures.join(', ')}`,
        sourceRefs: caseData.sourceRefs,
        suggestedSkills: opts.availableSkills ?? [],
        expectedInformationGain: 0.3,
        estimatedCost: 0.5,
      })
    }
  }

  // If hypothesis was validated, suggest escalation paths
  if (caseData.outcome === 'validated') {
    pivots.push({
      title: 'Test impact escalation',
      hypothesis: `Confirmed finding. Test for wider impact: data exfiltration, privilege escalation, or lateral movement.`,
      sourceRefs: caseData.sourceRefs,
      suggestedSkills: ['data-exfiltration', 'lateral-movement', 'persistence'],
      expectedInformationGain: 0.6,
      estimatedCost: 0.5,
    })
  }

  return pivots
}

/**
 * Promote pivots to ResearchOpportunities.
 * Creates opportunities in the store for each pivot.
 */
export function promotePivotsToOpportunities(
  runId: string,
  targetRef: string,
  pivots: ProposedPivot[],
): ResearchOpportunity[] {
  return pivots.map(pivot =>
    createOrUpdate(runId, targetRef, {
      type: pivot.title,
      source: 'pivot',
    }, {
      title: pivot.title,
      summary: pivot.hypothesis,
      evidenceRefs: pivot.sourceRefs,
      suggestedSkills: pivot.suggestedSkills.map(skillId => ({
        skillId,
        score: 50,
        reason: 'pivot from investigation',
      })),
      priority: pivot.expectedInformationGain
        ? Math.round(pivot.expectedInformationGain * 100)
        : 50,
    }),
  )
}
