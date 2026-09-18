/**
 * Opportunity Scorer (Phase 2).
 *
 * Deterministic scoring for ResearchOpportunities. No LLM involvement.
 * Uses signals like severity, novelty, observation count, and skill coverage
 * to prioritize which opportunities to investigate first.
 */

import type { ResearchOpportunity } from './types'

/** Scoring weights */
const WEIGHTS = {
  severityPrior: 20,
  novelty: 15,
  repeatedObservation: 10,
  skillCoverage: 10,
  evidenceStrength: 15,
  provenBenignPenalty: -30,
  alreadyTestedPenalty: -20,
  insufficientSignalPenalty: -15,
}

/** Severity prior scores */
const SEVERITY_SCORES: Record<string, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
  info: 0.1,
}

/**
 * Score an opportunity for prioritization.
 * Returns a number between 0 and 100.
 */
export function scoreOpportunity(
  opp: ResearchOpportunity,
  context: {
    /** Whether this technique has been tested before */
    alreadyTested?: boolean
    /** Whether this was proven benign */
    provenBenign?: boolean
    /** Number of untested skills that could apply */
    untestedSkillCount?: number
    /** Strength of evidence (0-1) */
    evidenceStrength?: number
  } = {},
): number {
  let score = 50 // base

  // Severity prior from suggested skills
  const topSkill = opp.suggestedSkills[0]
  if (topSkill) {
    score += WEIGHTS.severityPrior * (topSkill.score / 100)
  }

  // Novelty: new opportunities score higher
  if (opp.seenCount === 1) {
    score += WEIGHTS.novelty
  } else if (opp.seenCount > 3) {
    // Repeated observation increases confidence
    score += WEIGHTS.repeatedObservation * Math.min(opp.seenCount / 5, 1)
  }

  // Skill coverage: more untested skills = more investigation value
  if (context.untestedSkillCount && context.untestedSkillCount > 0) {
    score += WEIGHTS.skillCoverage * Math.min(context.untestedSkillCount / 3, 1)
  }

  // Evidence strength
  if (context.evidenceStrength !== undefined) {
    score += WEIGHTS.evidenceStrength * context.evidenceStrength
  }

  // Penalties
  if (context.provenBenign) score += WEIGHTS.provenBenignPenalty
  if (context.alreadyTested) score += WEIGHTS.alreadyTestedPenalty
  if (opp.evidenceRefs.length === 0 && opp.seenCount <= 1) {
    score += WEIGHTS.insufficientSignalPenalty
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * Rank opportunities by score (descending).
 */
export function rankOpportunities(
  opps: ResearchOpportunity[],
  context?: Parameters<typeof scoreOpportunity>[1],
): Array<{ opportunity: ResearchOpportunity; score: number }> {
  return opps
    .map(o => ({ opportunity: o, score: scoreOpportunity(o, context) }))
    .sort((a, b) => b.score - a.score)
}
