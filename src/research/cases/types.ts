/**
 * ResearchCase types (Phase 4).
 *
 * A ResearchCase is a distilled investigation lesson. It captures what
 * was hypothesized, what evidence supported or contradicted it, and
 * what was learned. Sensitive values are stripped for reusable memory.
 */

export type CaseOutcome = 'validated' | 'rejected' | 'inconclusive'

export interface ResearchCase {
  id: string
  domain: string
  skillId?: string
  initialHypothesis: string
  contextFeatures: string[]
  decisiveEvidence: string[]
  counterEvidence: string[]
  outcome: CaseOutcome
  falsePositiveReason?: string
  killSignal?: string
  reusableLesson?: string
  sourceRefs: string[]
}
