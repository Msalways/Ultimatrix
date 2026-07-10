/**
 * Campaign module — shared types.
 *
 * Implements Phase 2 T2.3 (planner) and T2.4 (executor) for the OODA solver.
 * The module is intentionally decoupled from the primitive runtime (which may
 * land in a later wave): primitives are referenced by id and executed through a
 * caller-supplied `PrimitiveRunner` callback.
 */

import type { UltimatrixConfig } from '../config'
import type { GraphStore } from '../graph/store'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import type { Severity } from '../types/shared'

// ─── Primitive references ───────────────────────────────────────────
// A lightweight, structural description of a primitive. Mirrors the shape the
// (not-yet-present) primitives registry is expected to export from
// src/primitives/framework.ts so this module compiles without it.

export interface PrimitiveRef {
  id: string
  description?: string
  tags?: string[]
}

export interface EvidenceItem {
  type: string
  data: string
  label: string
  timestamp: number
  session?: string
}

/**
 * Normalized result returned by a primitive run. The executor consumes this to
 * decide whether to persist a finding via `writeFinding`.
 */
export interface PrimitiveResult {
  primitiveId: string
  confirmed: boolean
  confidence?: number
  severity?: Severity
  title?: string
  description?: string
  cwe?: string
  payload?: string
  evidence?: EvidenceItem[]
  /** Optional token accounting for budget enforcement (trackTokens). */
  tokensUsed?: number
}

// ─── Campaign slice (unit of work) ─────────────────────────────────

export interface CampaignSlice {
  id: string
  endpoint: { id: string; url: string; method: string }
  params: string[]
  role: string
  state: string
  techniqueIds: string[]
  priority: number
  reason?: string
}

export interface CoverageStats {
  endpointsTotal: number
  endpointsCovered: number
  paramsTotal: number
  paramsCovered: number
  rolesTotal: number
  rolesCovered: number
  statesTotal: number
  statesCovered: number
  techniquesTotal: number
  techniquesPlanned: number
  slicesPlanned: number
  slicesExecuted: number
  slicesConfirmed: number
  humanHypothesesConsidered: number
}

export interface PlanOptions {
  /** Available primitives/techniques to plan against. */
  primitives: PrimitiveRef[]
  /** Fallback role used when an endpoint has no discernible auth context. */
  defaultRole?: string
  /** Include an anonymous (unauthenticated) role for unauthenticated endpoints. */
  includeAnonymous?: boolean
  /** Hard cap on produced slices (highest priority first). */
  maxSlices?: number
  roleFilter?: string[]
  stateFilter?: string[]
  techniqueFilter?: string[]
}

export interface CampaignPlan {
  slices: CampaignSlice[]
  coverage: CoverageStats
  generatedAt: number
  options: PlanOptions
}

// ─── Executor types ────────────────────────────────────────────────

/** Context handed to the primitive runner for a single step. */
export interface SliceExecContext {
  slice: CampaignSlice
  graphStore: GraphStore
  config: UltimatrixConfig
  evidenceGate?: EvidenceGate
  /** Provider key for the rate limiter (defaults to config.provider). */
  provider: string
}

export type PrimitiveRunner = (
  primitiveId: string,
  slice: CampaignSlice,
  ctx: SliceExecContext,
) => Promise<PrimitiveResult>

/** Normalized finding persisted/returned by the campaign. */
export interface Finding {
  id: string
  type: string
  endpoint: string
  param: string
  method: string
  payload: string
  description: string
  severity: Severity
  confidence: number
  confirmed: boolean
  evidence: EvidenceItem[]
  graphNodeId: string
  lifecycleStatus: string
  evidenceLevel: string
  findingId: string
  deduplicated: boolean
}

export interface SliceOutcome {
  slice: CampaignSlice
  results: PrimitiveResult[]
  confirmed: number
  budgetExceeded: boolean
}

export interface CampaignExecutorOptions {
  graphStore: GraphStore
  config: UltimatrixConfig
  /** Runs a single primitive against a slice; returns a normalized result. */
  executor: PrimitiveRunner
  evidenceGate?: EvidenceGate
  onSliceComplete?: (outcome: SliceOutcome) => void | Promise<void>
  /** Provider key for rate limiting. Defaults to config.provider. */
  provider?: string
  /** Bounded concurrency for slice execution. Defaults to rateLimit.maxConcurrent. */
  maxConcurrency?: number
  /** Optional slice routing for multi-model fan-out (Phase 4). */
  modelSelector?: import('../models/selector').ModelSelector
}

export interface CampaignResult {
  findings: Finding[]
  coverage: CoverageStats
  budgetExceeded: boolean
  slicesRun: number
}

export type WriteFindingTool = {
  execute: (args: Record<string, unknown>, runtimeContext?: unknown) => Promise<{ ok: boolean; value?: Finding }>
}
