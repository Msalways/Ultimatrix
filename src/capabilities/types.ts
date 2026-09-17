/**
 * Capability Compiler types (Phase 6).
 *
 * The Capability Compiler takes skill declarations + policy constraints and
 * produces a narrow, typed tool surface for a worker. This replaces the
 * previous approach where workers received a bloated CORE_TOOLS set.
 */

import type { SkillMeta, SkillContract } from '../solver/skills/loader'

/** What the compiler produces */
export interface CompiledCapabilitySet {
  /** Tool IDs the worker is authorized to use */
  tools: string[]
  /** Primitive IDs the worker can call (empty if skill declares none) */
  primitives: string[]
  /** Evidence capture policy for this worker */
  evidencePolicy: EvidencePolicy
  /** The skill metadata that produced this set */
  skill: SkillMeta
  /** Total estimated token count for the tool schemas */
  estimatedTokens: number
  /** Structured Skill Contract (present when skill declares one) */
  contract?: SkillContract
  /** Capability coverage validation result (present when contract exists) */
  coverageValidation?: CapabilityCoverageValidation
}

/** Result of validating a compiled tool surface against contract capabilities */
export interface CapabilityCoverageValidation {
  /** All declared capabilities */
  required: string[]
  /** Capabilities that have matching tools in the compiled set */
  covered: string[]
  /** Capabilities that lack matching tools */
  uncovered: string[]
  /** Whether all capabilities are covered */
  complete: boolean
}

/** Evidence policy for a compiled worker */
export interface EvidencePolicy {
  /** httpRequest auto-captures request/response evidence (always true) */
  autoCapture: boolean
  /** Worker can call linkEvidenceToClaim for additional observations */
  manualEvidenceAllowed: boolean
  /** Worker must attach evidence claims to findings */
  requireClaimBeforeWrite: boolean
}

/** Compiler input */
export interface CompilerInput {
  /** Skill IDs to compile for */
  skillIds: string[]
  /** Optional task description for context */
  task?: string
  /** Policy overrides */
  policy?: CompilerPolicy
}

/** Policy constraints applied during compilation */
export interface CompilerPolicy {
  /** Maximum tools allowed (default: 30) */
  maxTools?: number
  /** Allow session plumbing tools (saveSession, restoreSession, etc.) */
  allowSessionTools?: boolean
  /** Allow graph analysis tools (queryRelations, getGraphSchema, etc.) */
  allowGraphAnalysisTools?: boolean
  /** Require skill to declare primitives (fail if empty) */
  requirePrimitives?: boolean
  /** Allow manual evidence attachment */
  allowManualEvidence?: boolean
}

/** Default policy: balanced security */
export const DEFAULT_COMPILER_POLICY: Required<CompilerPolicy> = {
  maxTools: 30,
  allowSessionTools: false,
  allowGraphAnalysisTools: false,
  requirePrimitives: false,
  allowManualEvidence: false,
}

/** Estimated tokens per tool schema (used for budget enforcement) */
export const TOKENS_PER_TOOL = 60
