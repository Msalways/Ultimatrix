/**
 * Technique planner — Phase 9 (ORCHESTRATION-LAYER-FIX.md T3).
 *
 * Converts a `DiagnosisProfile` into ranked, executable `TechniqueCandidate`s
 * and an `AdvancedPlaybook`. Ranking routes on structured attack-surface
 * signals + derived primitive metadata (no free-text routing):
 *
 *  - signal → primitive-tag families (producer const, mirrors the analyser
 *    use-case map precedent)
 *  - direct primitive execution when enough context exists
 *  - worker delegation when high-priority context is missing (exploration)
 */

import type { PrimitiveMetadata } from '../primitives/framework'
import { listPrimitiveMetadata } from '../primitives/framework'
import { getTechniqueRegistry } from '../skills/technique-registry'
import type {
  AdvancedPlaybook,
  AttackSurfaceSignal,
  DiagnosisProfile,
  MissingContextRequirement,
  TechniqueCandidate,
} from './types'

export interface PlanContextInput {
  signals: AttackSurfaceSignal[]
  objectIdParams: string[]
  urlLikeParams: string[]
  graphqlEndpoints: string[]
  stateChangingEndpoints: string[]
  authBound: boolean
  hasSecondOrder: boolean
  hasWorkflowOrder: boolean
  hasOast: boolean
  hasSerialized: boolean
  hasCustomHeader: boolean
  workflows: number
  /** Global context gaps to attach to matching candidates. */
  missingContext?: MissingContextRequirement[]
}

export interface RankOptions {
  maxCandidates?: number
}

export interface PlaybookOptions extends RankOptions {
  /** Restrict execution to these candidate ids (from a previous diagnosis). */
  selectedCandidateIds?: string[]
}

// ─── Signal → tag families (producer const) ──────────────────────────

interface SignalFamily {
  signal: string
  weight: number
  tags: string[]
  /** Endpoint-scoped signals attach the first matching endpoint id. */
  endpointScoped?: boolean
  /** Param-scoped signals attach the first matching param name. */
  paramScoped?: boolean
}

const SIGNAL_FAMILIES: SignalFamily[] = [
  {
    signal: 'object-id-param', weight: 3, tags: ['idor', 'bola', 'authz', 'object', 'id', 'privilege', 'escalation', 'swapper'],
    endpointScoped: true, paramScoped: true,
  },
  {
    signal: 'auth-bound', weight: 2, tags: ['auth', 'authorization', 'bypass', 'jwt', 'session', 'authz', 'privilege'],
    endpointScoped: true,
  },
  {
    signal: 'graphql', weight: 4, tags: ['graphql', 'introspection', 'depth'],
    endpointScoped: true,
  },
  {
    signal: 'url-like-param', weight: 3, tags: ['ssrf', 'oast', 'cloud', 'metadata', 'redirect', 'open'],
    endpointScoped: true, paramScoped: true,
  },
  {
    signal: 'workflow-order', weight: 3, tags: ['workflow', 'business', 'logic', 'order', 'abuse'],
  },
  {
    signal: 'state-changing', weight: 2, tags: ['race', 'concurrency', 'business', 'logic', 'smuggling', 'workflow'],
    endpointScoped: true,
  },
  {
    signal: 'second-order', weight: 3, tags: ['second', 'order', 'stored', 'injection', 'sqli', 'nosql'],
  },
  {
    signal: 'custom-header', weight: 2, tags: ['smuggling', 'header', 'injection', 'host'],
    endpointScoped: true,
  },
  {
    signal: 'proxy-hint', weight: 2, tags: ['smuggling', 'header', 'host', 'ssrf'],
    endpointScoped: true,
  },
  {
    signal: 'serialized-content', weight: 2, tags: ['deserialization', 'type', 'juggling', 'xml', 'yaml'],
    endpointScoped: true,
  },
  {
    signal: 'tenant-scoped-param', weight: 3, tags: ['tenant', 'bola', 'isolation'],
    endpointScoped: true, paramScoped: true,
  },
  {
    signal: 'session-reach', weight: 2, tags: ['auth', 'session', 'reuse', 'bypass'],
  },
]

// ─── Context requirements → candidate tags ───────────────────────────

const CONTEXT_TAGS: Array<{ context: string; tags: string[] }> = [
  { context: 'second-user', tags: ['idor', 'bola', 'authz', 'authorization', 'privilege'] },
  { context: 'session-headers', tags: ['auth', 'authorization', 'idor', 'authz', 'bypass', 'session'] },
  { context: 'alternate-object-id', tags: ['idor', 'bola'] },
  { context: 'oast-host', tags: ['ssrf', 'oast', 'cloud'] },
  { context: 'workflow-steps', tags: ['workflow', 'business', 'logic'] },
  { context: 'graphql-schema', tags: ['graphql'] },
]

const EVIDENCE_FAMILIES: Array<{ tags: string[]; shape: string }> = [
  { tags: ['ssrf', 'oast', 'cloud'], shape: 'oast' },
  { tags: ['xss'], shape: 'render' },
  { tags: ['id', 'idor', 'bola'], shape: 'state' },
]

// ─── Scoring ─────────────────────────────────────────────────────────

function scoreFor(
  meta: PrimitiveMetadata,
  ctx: PlanContextInput,
): { score: number; reason: string[]; signalHits: string[] } {
  let score = 0
  const reason: string[] = []
  const signalHits: string[] = []

  for (const family of SIGNAL_FAMILIES) {
    const present = ctx.signals.some((s) => s.name === family.signal)
    if (!present) continue
    const hit = family.tags.some((t) => meta.tags.includes(t))
    if (!hit) continue
    score += family.weight
    signalHits.push(family.signal)
    reason.push(`${family.signal} matches ${meta.id}`)
  }

  // Structural boosts that do not rely on signal names.
  if (ctx.authBound && (meta.tags.includes('authz') || meta.tags.includes('idor') || meta.tags.includes('authorization'))) {
    score += 1
  }
  if (ctx.hasSecondOrder && meta.tags.includes('second')) score += 1
  if (ctx.hasWorkflowOrder && (meta.tags.includes('workflow') || meta.tags.includes('business'))) score += 1
  if (ctx.hasOast && (meta.tags.includes('oast') || meta.tags.includes('ssrf'))) score += 0.5
  if (ctx.hasSerialized && meta.tags.includes('deserialization')) score += 1
  if (ctx.hasCustomHeader && (meta.tags.includes('smuggling') || meta.tags.includes('header'))) score += 1

  // Self-evolution (spec 05): evolved effectiveness weight multiplies the
  // structural score — techniques that historically confirm findings rank
  // ahead; repeatedly-failing ones sink. Weight is a registry runtime
  // override (static base config never mutated).
  const evolutionWeight = getTechniqueRegistry().getTechniqueWeight(meta.id)
  if (evolutionWeight !== 1.0) {
    score *= evolutionWeight
    reason.push(`evolved weight ${evolutionWeight.toFixed(2)}`)
  }

  return { score, reason, signalHits }
}

// ─── Endpoint/param attachment ────────────────────────────────────────

function attachEndpointParam(
  meta: PrimitiveMetadata,
  ctx: PlanContextInput,
): { endpointId?: string; param?: string } {
  for (const family of SIGNAL_FAMILIES) {
    if (!family.endpointScoped && !family.paramScoped) continue
    if (!family.tags.some((t) => meta.tags.includes(t))) continue
    const sig = ctx.signals.find((s) => s.name === family.signal)
    if (!sig) continue
    const endpointId = sig.endpointIds[0]
    if (family.paramScoped && sig.paramNames?.length) {
      return { endpointId, param: sig.paramNames[0] }
    }
    if (family.endpointScoped) return { endpointId, param: undefined }
  }
  return {}
}

// ─── Missing context per candidate ───────────────────────────────────

function candidateMissingContext(
  meta: PrimitiveMetadata,
  globalMissing: MissingContextRequirement[],
): MissingContextRequirement[] {
  const out: MissingContextRequirement[] = []
  for (const req of globalMissing) {
    const family = CONTEXT_TAGS.find((c) => c.context === req.context)
    if (!family) continue
    if (family.tags.some((t) => meta.tags.includes(t))) out.push(req)
  }
  return out
}

function evidenceNeeded(meta: PrimitiveMetadata): string[] {
  const shapes = ['raw_request', 'raw_response']
  for (const f of EVIDENCE_FAMILIES) {
    if (f.tags.some((t) => meta.tags.includes(t)) && !shapes.includes(f.shape)) shapes.push(f.shape)
  }
  return shapes
}

// ─── Ranking ─────────────────────────────────────────────────────────

export function rankTechniqueCandidates(
  ctx: PlanContextInput,
  primitives: PrimitiveMetadata[],
  options: RankOptions = {},
): TechniqueCandidate[] {
  const scored = primitives
    .map((meta) => {
      const { score, reason, signalHits } = scoreFor(meta, ctx)
      const { endpointId, param } = attachEndpointParam(meta, ctx)
      const execution: 'primitive' | 'worker' = signalHits.length > 0 ? 'primitive' : 'worker'
      return {
        meta,
        score,
        reason,
        execution,
        endpointId,
        param,
      }
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.meta.id.localeCompare(b.meta.id))

  const cap = options.maxCandidates && options.maxCandidates > 0
    ? options.maxCandidates
    : scored.length

  const globalMissing = ctx.missingContext ?? []

  return scored.slice(0, cap).map((c, idx) => {
    const missing = candidateMissingContext(c.meta, globalMissing)
    const candidate: TechniqueCandidate = {
      id: `${c.meta.id}${c.endpointId ? `:${c.endpointId}` : ''}`,
      primitiveId: c.meta.id,
      skillId: recommendSkillFor(c.meta),
      name: c.meta.name,
      technique: c.meta.technique,
      reason: c.reason.join('; ') || `relevant to the diagnosed surface`,
      confidence: Math.min(0.95, 0.4 + c.score * 0.12),
      priority: idx,
      requiredContext: c.meta.requiredContext,
      missingContext: missing,
      evidenceNeeded: evidenceNeeded(c.meta),
      endpointId: c.endpointId,
      param: c.param,
      execution: c.execution,
    }
    if (c.execution === 'worker' && candidate.skillId) candidate.workerId = candidate.skillId
    return candidate
  })
}

/** Map a primitive's derived tags to a skill id for on-demand methodology loading. */
export function recommendSkillFor(meta: PrimitiveMetadata): string | undefined {
  const tags = meta.tags
  const table: Array<{ keys: string[]; skill: string }> = [
    { keys: ['sqli', 'injection'], skill: 'exploitation' },
    { keys: ['graphql'], skill: 'graphql-attacks' },
    { keys: ['ssrf'], skill: 'blind-ssrf' },
    { keys: ['nosql'], skill: 'nosql-injection' },
    { keys: ['ssti'], skill: 'ssti' },
    { keys: ['deserialization'], skill: 'deserialization' },
    { keys: ['smuggling'], skill: 'http-smuggling' },
    { keys: ['xss'], skill: 'modern-xss' },
    { keys: ['idor', 'bola'], skill: 'authorization' },
    { keys: ['jwt', 'auth'], skill: 'authorization' },
    { keys: ['race', 'concurrency'], skill: 'race-conditions-advanced' },
    { keys: ['workflow', 'business'], skill: 'business-logic' },
    { keys: ['xml', 'xxe'], skill: 'xxe' },
    { keys: ['api'], skill: 'api-security' },
  ]
  for (const row of table) {
    if (row.keys.some((k) => tags.includes(k))) return row.skill
  }
  return undefined
}

// ─── Playbook builder ────────────────────────────────────────────────

export function buildAdvancedPlaybook(
  profile: DiagnosisProfile,
  options: PlaybookOptions = {},
): AdvancedPlaybook {
  let candidates = profile.rankedTechniques

  if (options.selectedCandidateIds && options.selectedCandidateIds.length > 0) {
    candidates = candidates.filter((c) => options.selectedCandidateIds!.includes(c.id))
  }

  if (options.maxCandidates && options.maxCandidates > 0) {
    candidates = candidates.slice(0, options.maxCandidates)
  }

  // Execution selection: direct primitive run when the candidate's context is
  // sufficient; worker delegation (exploratory reasoning) when high-priority
  // context is missing. Rationale recorded in `reason` so the caller can see it.
  const metadataById = new Map<string, PrimitiveMetadata>(listPrimitiveMetadata().map((m) => [m.id, m]))

  const executed = candidates.map((c) => {
    // Attach profile-level missing context when the candidate did not already
    // carry it (callers may build a profile without ranking first).
    const meta = c.primitiveId ? metadataById.get(c.primitiveId) : undefined
    const missing = c.missingContext.length > 0 || !meta
      ? c.missingContext
      : candidateMissingContext(meta, profile.missingContext)
    const needsExploration = missing.some((m) => m.priority === 'high')
    if (!needsExploration) {
      return missing.length > 0 ? { ...c, missingContext: missing } : c
    }
    const delegated: TechniqueCandidate = {
      ...c,
      missingContext: missing,
      execution: 'worker',
      workerId: c.skillId,
      reason: `${c.reason}; delegated to worker: missing context (${missing
        .filter((m) => m.priority === 'high')
        .map((m) => m.context)
        .join(', ')})`,
    }
    return delegated
  })

  return {
    candidates: executed,
    generatedAt: Date.now(),
    missingContext: profile.missingContext,
  }
}
