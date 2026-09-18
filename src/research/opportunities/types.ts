/**
 * ResearchOpportunity types (Phase 2).
 *
 * A first-class pre-task concept: "this looks interesting, investigate it."
 * Unlike Hypothesis (which is endpoint-specific) or CandidateFinding (which
 * is a finding candidate), a ResearchOpportunity represents an investigation
 * direction with lifecycle, deduplication, and scoring.
 */

/** Signal that originated an opportunity */
export interface OpportunitySignal {
  /** What kind of signal (e.g., 'suspicious-endpoint', 'auth-anomaly') */
  type: string
  /** Where the signal came from */
  source: 'traffic' | 'graph' | 'recon' | 'scanner' | 'research' | 'human' | 'pivot'
}

/** Opportunity lifecycle status */
export type OpportunityStatus = 'new' | 'investigating' | 'parked' | 'killed' | 'promoted'

/** Why an opportunity was killed */
export type OpportunityKillReason =
  | 'duplicate'
  | 'out_of_scope'
  | 'already_tested'
  | 'insufficient_signal'
  | 'policy_denied'
  | 'proven_benign'
  | 'budget_exhausted'

/** A research opportunity */
export interface ResearchOpportunity {
  /** Unique ID */
  id: string
  /** Run ID */
  runId: string
  /** Target this opportunity relates to */
  targetRef: string
  /** Human-readable title */
  title: string
  /** Brief summary of what to investigate */
  summary: string
  /** The signal that created this opportunity */
  signal: OpportunitySignal
  /** Evidence refs supporting this opportunity */
  evidenceRefs: string[]
  /** Artifact refs supporting this opportunity */
  artifactRefs: string[]
  /** Skills that could investigate this opportunity */
  suggestedSkills: Array<{
    skillId: string
    score: number
    reason: string
  }>
  /** Priority score (higher = more important) */
  priority: number
  /** Current lifecycle status */
  status: OpportunityStatus
  /** When first observed */
  firstSeenAt: number
  /** When last observed */
  lastSeenAt: number
  /** How many times this signal has been observed */
  seenCount: number
  /** Task IDs created from this opportunity */
  taskRefs: string[]
  /** Candidate finding IDs from this opportunity */
  candidateRefs: string[]
  /** Kill reason (only when status is 'killed') */
  killReason?: OpportunityKillReason
  /** Kill timestamp */
  killedAt?: number
}
