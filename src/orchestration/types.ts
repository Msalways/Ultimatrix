/**
 * Orchestration layer — shared types.
 *
 * Phase 9 (ORCHESTRATION-LAYER-FIX.md T1–T8): a central planner that reads the
 * current graph/capture state and decides what to load and run next. The types
 * below are the contract between diagnosis → technique planning → playbook
 * execution. All seams are structured/typed — no regex or free-text routing.
 */

import type { PrimitiveMetadata } from '../primitives/framework'

// ─── Attack surface signals ──────────────────────────────────────────

/**
 * A structured, shape/type-derived observation about the target's attack
 * surface. Produced from graph data (param shape, method class, typed endpoint
 * semantics, relations) — NOT from scanning free text.
 */
export interface AttackSurfaceSignal {
  /** Stable signal id (e.g. 'object-id-param', 'url-like-param', 'graphql'). */
  name: string
  /** Signal provenance: endpoint / param / header / workflow / relation / auth. */
  kind: string
  /** Endpoint node ids that exhibit this signal. */
  endpointIds: string[]
  /** Param names involved (when param-kind). */
  paramNames?: string[]
  /** Human-readable justification — structural only, never a vocab claim. */
  detail?: string
  confidence: number
}

// ─── Missing context ─────────────────────────────────────────────────

export interface MissingContextRequirement {
  /** Context key (e.g. 'auth-role', 'second-user', 'alternate-object-id'). */
  context: string
  reason: string
  /** Candidate technique ids blocked by this gap. */
  techniqueIds?: string[]
  priority: 'high' | 'medium' | 'low'
}

// ─── Technique candidates ────────────────────────────────────────────

export interface TechniqueCandidate {
  /** Stable candidate id (selectable in runAdvancedPlaybook). */
  id: string
  /** Primitive id when direct execution applies. */
  primitiveId?: string
  /** Skill id to load when the technique needs methodology. */
  skillId?: string
  /** Worker id when delegation (exploratory reasoning) is selected. */
  workerId?: string
  name: string
  technique?: string
  reason: string
  confidence: number
  /** Sort key — lower is better. Populated by the planner. */
  priority: number
  requiredContext: string[]
  missingContext: MissingContextRequirement[]
  /** Evidence shapes a confirmed result must carry (e.g. raw_request/response). */
  evidenceNeeded: string[]
  endpointId?: string
  param?: string
  /** Direct primitive run vs worker delegation. */
  execution: 'primitive' | 'worker'
}

// ─── Diagnosis profile ───────────────────────────────────────────────

export interface DiagnosedEndpoint {
  id: string
  url: string
  method: string
  params: string[]
  paramTypes: Record<string, string | undefined>
  /** Captured request header names (typed, from the graph). */
  headers?: string[]
  authRequired?: boolean
  authType?: string
  useCase?: string
  tags?: string[]
}

export interface DiagnosedRelation {
  type: string
  fromId: string
  toId: string
  fromUrl?: string
  toUrl?: string
}

export interface DiagnosedWorkflow {
  id: string
  name?: string
  steps: string[]
  relatedEndpoints: string[]
  requiredAuth?: boolean
}

export interface KnownContext {
  endpoints: DiagnosedEndpoint[]
  authTypes: string[]
  roles: string[]
  authFlows: string[]
  workflows: DiagnosedWorkflow[]
  relations: DiagnosedRelation[]
  findings: Array<{ id: string; technique: string; endpoint?: string; severity: string }>
  /** Object-id-shaped params (structural id shape). */
  objectIdParams: string[]
  /** URL-shaped params (declared param type or URL-field shape). */
  urlLikeParams: string[]
  graphqlEndpoints: string[]
  stateChangingEndpoints: string[]
  hasOast: boolean
  hasReachability: boolean
}

export interface DiagnosisProfile {
  target?: string
  summary: {
    endpointCount: number
    authFlowCount: number
    rbacRoleCount: number
    findingCount: number
    candidateFindingCount: number
    workflowCount: number
    relationCount: number
    hasEndpoints: boolean
    hasAuth: boolean
  }
  knownContext: KnownContext
  missingContext: MissingContextRequirement[]
  attackSurfaces: AttackSurfaceSignal[]
  rankedTechniques: TechniqueCandidate[]
  recommendedSkills: Array<{ id: string; name: string; domain: string; reason: string }>
  recommendedPrimitives: string[]
  recommendedWorkers: string[]
}

// ─── Advanced playbook ───────────────────────────────────────────────

export interface AdvancedPlaybook {
  candidates: TechniqueCandidate[]
  generatedAt: number
  missingContext: MissingContextRequirement[]
}

export interface PlaybookExecution {
  candidateId: string
  primitiveId?: string
  workerId?: string
  skillId?: string
  ok: boolean
  confirmed: boolean
  note?: string
}

export interface PlaybookRunResult {
  executed: PlaybookExecution[]
  skipped: Array<{ candidateId: string; reason: string }>
  confirmed: number
  unconfirmed: number
  missingContext: MissingContextRequirement[]
  loadedSkills: string[]
}

// ─── Re-export primitive metadata ────────────────────────────────────

export type { PrimitiveMetadata }
