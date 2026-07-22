/**
 * Council — multi-agent deliberation types.
 *
 * The council replaces the single advisory "Hex" brain with a set of specialist
 * personas that deliberately coordinate an attack, with the human seated as a
 * member. This is the architectural backbone that makes the P0 intelligence
 * layers *enforceable*: the `skeptic` hard-gates every claim via the structured
 * EvidenceGate, and high-impact actions require human approval (HITL mode).
 *
 * Design principle: typed fields, never substring scanning of free text.
 * Council members output structured data. The orchestrator reads typed fields,
 * never parses text.
 */

import type { FindingClaim } from '../intelligence/evidence-ledger'

// ─── Roles ─────────────────────────────────────────────────────────────────

export type CouncilMemberRole =
  | 'strategist' // the attacker mind: proposes hypotheses & experiments
  | 'operator' // the hands: executes via tools/workers
  | 'skeptic' // anti-hallucination reviewer: enforces structured evidence
  | 'analyst' // correlator: builds the research map, chains findings
  | 'human' // seated member: proposes, votes, approves/blocks

// ─── Structured output types ───────────────────────────────────────────────

/** What the member intends with this output. Orchestrator reads this, never text. */
export type CouncilIntent = 'propose' | 'critique' | 'complete' | 'escalate'

/** Impact level — declared by the LLM, not guessed via regex on text. */
export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical'

/** Complexity for worker dispatch — maps to model tier via ModelSelector. */
export type TaskComplexity = 'low' | 'medium' | 'high' | 'critical'

/** A concrete attack proposal from a council member. */
export interface CouncilProposal {
  /** What to do — human-readable for bus display. */
  action: string
  /** Skill to load for this attack (maps to skill file). */
  skillId: string
  /** Optional graph endpoint node ID for context. */
  endpointId?: string
  /** Task complexity — drives model tier selection via ModelSelector. */
  complexity: TaskComplexity
  /** Impact level — LLM declares this, orchestrator uses it for approval gating. */
  impact: ImpactLevel
  /** Why this action — reasoning for human and other members. */
  reasoning: string
  /** What evidence is needed before executing this. */
  evidenceRequired: string[]
}

/**
 * Pure mapping from council-declared task complexity to worker model tier.
 * No hardcoding of skill→tier; the LLM declares complexity, we translate it
 * to the model-pool tier the worker should run on.
 */
export type WorkerTier = 'fast' | 'balanced' | 'powerful'

const COMPLEXITY_TO_TIER: Record<TaskComplexity, WorkerTier> = {
  low: 'fast',
  medium: 'balanced',
  high: 'powerful',
  critical: 'powerful',
}

export function complexityToTier(c: TaskComplexity): WorkerTier {
  return COMPLEXITY_TO_TIER[c]
}

/**
 * Minimal worker config shape the proposal can translate into. Declared here
 * to avoid a circular import with workers/factory; the real WorkerConfig is
 * structurally compatible. The translation is the single source of truth for
 * "council proposal → worker spawn" so no `as any` casts are needed at the call site.
 */
export interface ProposalWorkerConfig {
  skillId: string
  task: string
  tier: WorkerTier
  context?: {
    endpointId?: string
    reasoning?: string
    evidenceRequired?: string[]
    impact?: ImpactLevel
    [key: string]: unknown
  }
  /** Allow additional fields (modelId, tenant, sandboxId) to pass through. */
  [key: string]: unknown
}

/** Faithful translation of a CouncilProposal into a worker spawn config. */
export function proposalToWorkerConfig(
  proposal: CouncilProposal,
  overrides?: Partial<ProposalWorkerConfig>,
): ProposalWorkerConfig {
  const base: ProposalWorkerConfig = {
    skillId: proposal.skillId,
    task: proposal.action,
    tier: complexityToTier(proposal.complexity),
    context: {
      endpointId: proposal.endpointId,
      reasoning: proposal.reasoning,
      evidenceRequired: proposal.evidenceRequired,
      impact: proposal.impact,
      ...overrides?.context,
    },
  }

  // Merge top-level overrides (modelId, tenant, sandboxId, etc.) without dropping context.
  const { context: _omit, ...rest } = overrides ?? {}
  return { ...base, ...rest }
}

/** A structured critique of other members' proposals. */
export interface CouncilCritique {
  /** Which roles this critique targets. */
  targets: string[]
  /** What the critic agrees with. */
  agreements: string[]
  /** What the critic disagrees with and why. */
  disagreements: string[]
  /** Evidence gaps — claims that lack supporting evidence items. */
  evidenceGaps: string[]
  /** Alternative suggestion if rejecting a proposal. */
  alternative?: string
}

/** Structured reflection on worker execution results. */
export interface CouncilReflection {
  /** What worked — techniques that produced findings. */
  whatWorked: string[]
  /** What failed — techniques that didn't work and why. */
  whatFailed: string[]
  /** What we learned — new information about the target. */
  whatLearned: string[]
  /** Concrete next steps — what to do next. */
  nextSteps: string[]
}

// ─── Member output ─────────────────────────────────────────────────────────

/**
 * Structured output from a council member.
 *
 * Design principle: the orchestrator reads typed fields (intent, proposal,
 * critique, reflection), never parses the text field. The text field is
 * for human display in the bus transcript only.
 */
export interface MemberOutput {
  /** Human-readable text for bus display. NOT parsed by orchestrator. */
  text: string
  /** What this output intends — orchestrator switches on this. */
  intent: CouncilIntent
  /** Present when intent === 'propose'. */
  proposal?: CouncilProposal
  /** Present when intent === 'critique'. */
  critique?: CouncilCritique
  /** Present when intent === 'complete' or 'escalate'. */
  reflection?: CouncilReflection
  /** Structured claim for evidence verification (optional). */
  claim?: FindingClaim
}

// ─── Bus ───────────────────────────────────────────────────────────────────

export type ApprovalMode = 'autonomous' | 'hitl' | 'both'

export type CouncilMessageType =
  | 'proposal'
  | 'critique'
  | 'approve'
  | 'reject'
  | 'execute'
  | 'report'
  | 'reflect'
  | 'human'
  | 'system'

export interface CouncilMessage {
  id: string
  round: number
  from: CouncilMemberRole
  to?: CouncilMemberRole
  type: CouncilMessageType
  text: string
  /** Structured claim attached to proposals, verified by the skeptic. */
  claim?: FindingClaim
  timestamp: number
}

// ─── Member ────────────────────────────────────────────────────────────────

/** A council member. `respond` returns structured output with typed fields. */
export interface CouncilMember {
  id: string
  role: CouncilMemberRole
  tier: 'fast' | 'balanced' | 'powerful'
  respond: (prompt: string) => Promise<MemberOutput>
}

// ─── Debate memory ─────────────────────────────────────────────────────────

export type StancePosition = 'for' | 'against' | 'alternative'

/** A member's position on a proposal or critique. */
export interface Stance {
  member: CouncilMemberRole
  round: number
  position: StancePosition
  target: string
  reasoning: string
}

/** A technique that failed in a previous round. */
export interface FailedApproach {
  round: number
  technique: string
  endpoint: string
  reason: string
}

/** A confirmed finding with supporting evidence. */
export interface ProvenFinding {
  round: number
  finding: string
  evidence: string
}

/** Accumulated debate memory across REPL turns. */
export interface DebateMemory {
  stances: Stance[]
  failedApproaches: FailedApproach[]
  provenFindings: ProvenFinding[]
}

// ─── Persona metadata ──────────────────────────────────────────────────────

/** Metadata parsed from persona .md file YAML frontmatter. */
export interface PersonaMetadata {
  id: string
  name: string
  role?: string
  tier?: string
  description?: string
  toolRestrictions?: string | string[]
  expertise?: string[]
  constraints?: string[]
  authority?: string
  backstory?: string
  perspective?: string
  debateBehavior?: string
  [key: string]: unknown
}

// ─── Config ────────────────────────────────────────────────────────────────

export interface CouncilConfig {
  enabled: boolean
  members: CouncilMemberRole[]
  approvalMode: ApprovalMode
  maxRounds: number
  /** Token budget guardrail per round (advisory; enforced by host). */
  budgetPerRound: number
  /** Optional persona overrides keyed by role. */
  personas?: Partial<Record<CouncilMemberRole, string>>
  /**
   * Per-member LLM respond() timeout in ms. If a member doesn't return
   * within this deadline, it produces an error output and the debate continues
   * with the remaining members. Default: 90 000 (90s).
   */
  respondTimeoutMs?: number
  /**
   * Per-proposal execute() timeout in ms. If the worker dispatch hangs,
   * the proposal is abandoned after this deadline. Default: 120 000 (120s).
   */
  executeTimeoutMs?: number
}

// ─── Debate cycle result ───────────────────────────────────────────────────

/** Result of a single debate cycle (one REPL turn). */
export interface DebateCycleResult {
  /** The council's synthesized response to the human. */
  summary: string
  /** Worker tasks the council wants to dispatch. */
  proposedTasks: Array<{
    skillId: string
    task: string
    endpointId?: string
    complexity: TaskComplexity
  }>
  /** New evidence items recorded this cycle. */
  newEvidence: number
  /** Messages posted to the bus this cycle. */
  messages: CouncilMessage[]
  /** Whether the council signals task completion. */
  complete: boolean
}

// ─── Intelligence context (reflexion + anti-loop visibility) ──────────────

/**
 * Intelligence context injected into council member prompts so the debate has
 * visibility into the solver's accumulated failure history and loop state.
 * All fields optional — backward compatible when not supplied.
 */
export interface IntelligenceContext {
  reflexionBlock?: string
  antiLoopStale?: boolean
  blockedTargets?: string[]
  attackPathHistory?: string[]
  escalationLevel?: number
  consecutiveFailures?: number
}

// ─── Legacy result (backward compat) ──────────────────────────────────────

export interface CouncilResult {
  rounds: number
  approved: number
  rejected: number
  messages: CouncilMessage[]
  transcript: string
}
