/**
 * Campaign Planner — Phase 2 / T2.3
 *
 * Reads the knowledge graph (via GraphStore) and builds a coverage matrix:
 *
 *   endpoint × param × role × state × technique(primitive)
 *
 * Then decides per-cell relevance, prioritizes using analyser-derived
 * invariants + open human Hypotheses, and dedupes equivalent cells into
 * CampaignSlice units of work.
 */

import { NodeType } from '../graph/schema'
import type {
  EndpointNode,
  AuthSchemeNode,
  RBACRoleNode,
  HypothesisNode,
  FactNode,
} from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type {
  CampaignPlan,
  CampaignSlice,
  CoverageStats,
  PlanOptions,
  PrimitiveRef,
} from './types'

const DEFAULT_ROLE = 'anonymous'
const ANONYMOUS_ROLE = 'anonymous'
const AUTHENTICATED_ROLE = 'authenticated'
const BASELINE_STATE = 'baseline'

// Techniques that do not require a parameterized endpoint to be meaningful.
const GENERIC_TECHNIQUE_TAGS = ['recon', 'info-disclosure', 'information-disclosure', 'fingerprint', 'discovery']

// Techniques that only matter when the endpoint requires authentication.
const AUTH_TECHNIQUE_TAGS = ['auth', 'authorization', 'session', 'jwt', 'idor', 'privilege', 'bypass']

interface EndpointContext {
  node: EndpointNode
  roles: string[]
  states: string[]
  params: string[]
}

function endpointParams(ep: EndpointNode): string[] {
  const fromParams = (ep.properties.params ?? []).map(p => p.name)
  const fromHeaders = ep.properties.headers ? Object.keys(ep.properties.headers) : []
  const set = new Set<string>([...fromParams, ...fromHeaders])
  return [...set].filter(Boolean)
}

function deriveRoles(ep: EndpointNode, rbacRoles: RBACRoleNode[], includeAnonymous: boolean): string[] {
  const roles = new Set<string>()
  const authRequired = !!ep.properties.authRequired
  const authType = ep.properties.authType

  if (authRequired || authType) {
    roles.add(AUTHENTICATED_ROLE)
    if (authType) roles.add(authType)
  }

  for (const rb of rbacRoles) {
    const accessible = rb.properties.accessibleEndpoints ?? []
    const inaccessible = rb.properties.inaccessibleEndpoints ?? []
    if (accessible.includes(ep.properties.url) || inaccessible.includes(ep.properties.url)) {
      roles.add(rb.properties.roleName)
      if (accessible.includes(ep.properties.url)) roles.add(AUTHENTICATED_ROLE)
    }
  }

  if (includeAnonymous && !authRequired && !authType) {
    roles.add(ANONYMOUS_ROLE)
  }

  return [...roles]
}

function deriveStates(ep: EndpointNode): string[] {
  const preconditions = ep.properties.preconditions ?? []
  if (preconditions.length === 0) return [BASELINE_STATE]
  return [BASELINE_STATE, ...preconditions.map(p => `precondition:${p}`)]
}

function isTechniqueRelevant(primitive: PrimitiveRef, ep: EndpointNode, hasParams: boolean): boolean {
  const tags = primitive.tags ?? []
  if (tags.some(t => GENERIC_TECHNIQUE_TAGS.includes(t))) return true
  if (hasParams) return true
  // Auth-bound techniques only relevant to authenticated/protected endpoints.
  const authRelevant = tags.some(t => AUTH_TECHNIQUE_TAGS.includes(t))
  if (authRelevant) return !!ep.properties.authRequired || !!ep.properties.authType
  return hasParams
}

/**
 * Build a campaign plan from the current graph state.
 */
export function planCampaign(graphStore: GraphStore, options: PlanOptions): CampaignPlan {
  const primitives = options.primitives ?? []
  const includeAnonymous = options.includeAnonymous ?? true
  const defaultRole = options.defaultRole ?? DEFAULT_ROLE

  const endpoints = graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const authSchemes = graphStore.queryNodes(NodeType.AUTH_SCHEME) as AuthSchemeNode[]
  const rbacRoles = graphStore.queryNodes(NodeType.RBAC_ROLE) as RBACRoleNode[]
  const hypotheses = (graphStore.queryNodes(NodeType.HYPOTHESIS) as HypothesisNode[]).filter(
    h => (h.properties.origin ?? 'llm') === 'human' && h.properties.status === 'open',
  )
  const facts = graphStore.queryNodes(NodeType.FACT) as FactNode[]

  // Read VALUE_ORIGIN edges for data-flow-aware prioritization
  const valueOriginEndpoints = new Set<string>()
  const edges = graphStore.getAllEdges?.() ?? []
  for (const edge of edges) {
    if (edge.type === 'VALUE_ORIGIN') {
      valueOriginEndpoints.add(edge.toId)
    }
  }

  // Reused-across auth schemes imply shared roles across endpoints.
  const reusedEndpoints = new Set<string>()
  for (const a of authSchemes) {
    for (const ep of a.properties.reusedAcross ?? []) reusedEndpoints.add(ep)
  }

  const epContexts: EndpointContext[] = endpoints.map(ep => {
    const params = endpointParams(ep)
    return {
      node: ep,
      roles: deriveRoles(ep, rbacRoles, includeAnonymous),
      states: deriveStates(ep),
      params,
    }
  })

  const roleFilter = options.roleFilter
  const stateFilter = options.stateFilter
  const techniqueFilter = options.techniqueFilter

  const slices: CampaignSlice[] = []
  const coveredEndpoints = new Set<string>()
  const coveredParams = new Set<string>()
  const coveredRoles = new Set<string>()
  const coveredStates = new Set<string>()
  const coveredTechniques = new Set<string>()

  for (const ctx of epContexts) {
    const ep = ctx.node
    const url = ep.properties.url
    const hasParams = ctx.params.length > 0

    const hypBoost = hypotheses.filter(h => (h.properties.targetEndpoints ?? []).includes(url)).length
    const factBoost = facts.filter(f => f.properties.description.includes(url)).length

    for (const role of ctx.roles) {
      if (roleFilter && !roleFilter.includes(role)) continue
      for (const state of ctx.states) {
        if (stateFilter && !stateFilter.includes(state)) continue

        const relevantTechniques = primitives.filter(p => {
          if (techniqueFilter && !techniqueFilter.includes(p.id)) return false
          return isTechniqueRelevant(p, ep, hasParams)
        })
        if (relevantTechniques.length === 0) continue

        let priority = 0
        if (role === AUTHENTICATED_ROLE || ep.properties.authType) priority += 2
        if (hasParams) priority += 1
        priority += Math.min(6, hypBoost * 3)
        priority += Math.min(3, factBoost)
        if (state !== BASELINE_STATE) priority += 1
        if (reusedEndpoints.has(url)) priority += 1
        if (valueOriginEndpoints.has(ep.id)) priority += 2

        const techniqueIds = relevantTechniques.map(p => p.id)
        const reasonBits: string[] = []
        if (hypBoost) reasonBits.push(`${hypBoost} human hypothes(is/es) target this endpoint`)
        if (ep.properties.authType) reasonBits.push(`auth:${ep.properties.authType}`)
        if (hasParams) reasonBits.push(`${ctx.params.length} param(s)`)

        slices.push({
          id: `slice:${ep.id}:${role}:${state}`,
          endpoint: { id: ep.id, url, method: ep.properties.method },
          params: ctx.params,
          role,
          state,
          techniqueIds,
          priority,
          reason: reasonBits.join('; ') || undefined,
        })

        coveredEndpoints.add(ep.id)
        ctx.params.forEach(p => coveredParams.add(`${ep.id}#${p}`))
        coveredRoles.add(role)
        coveredStates.add(state)
        techniqueIds.forEach(t => coveredTechniques.add(t))
      }
    }
  }

  // De-dupe empty-role default fallback: ensure at least the default role is
  // represented when no roles were derived.
  if (slices.length === 0 && endpoints.length > 0) {
    const ep = endpoints[0]
    slices.push({
      id: `slice:${ep.id}:${defaultRole}:${BASELINE_STATE}`,
      endpoint: { id: ep.id, url: ep.properties.url, method: ep.properties.method },
      params: endpointParams(ep),
      role: defaultRole,
      state: BASELINE_STATE,
      techniqueIds: primitives.map(p => p.id),
      priority: 1,
    })
    coveredEndpoints.add(ep.id)
  }

  slices.sort((a, b) => b.priority - a.priority)
  if (options.maxSlices && options.maxSlices > 0 && slices.length > options.maxSlices) {
    slices.length = options.maxSlices
  }

  const totalParams = epContexts.reduce((acc, c) => acc + c.params.length, 0)
  const allRoles = new Set<string>()
  for (const c of epContexts) c.roles.forEach(r => allRoles.add(r))
  const allStates = new Set<string>()
  for (const c of epContexts) c.states.forEach(s => allStates.add(s))

  const coverage: CoverageStats = {
    endpointsTotal: endpoints.length,
    endpointsCovered: coveredEndpoints.size,
    paramsTotal: totalParams,
    paramsCovered: coveredParams.size,
    rolesTotal: allRoles.size,
    rolesCovered: coveredRoles.size,
    statesTotal: allStates.size,
    statesCovered: coveredStates.size,
    techniquesTotal: primitives.length,
    techniquesPlanned: coveredTechniques.size,
    slicesPlanned: slices.length,
    slicesExecuted: 0,
    slicesConfirmed: 0,
    humanHypothesesConsidered: hypotheses.length,
  }

  return {
    slices,
    coverage,
    generatedAt: Date.now(),
    options,
  }
}

/**
 * Re-plan a campaign for newly discovered endpoints since the previous plan.
 * Only generates slices for endpoints not already covered in the previous plan.
 */
export function replanCampaign(
  graphStore: GraphStore,
  previousPlan: CampaignPlan,
  options: PlanOptions,
): CampaignPlan {
  const previousEndpoints = new Set(
    previousPlan.slices.map(s => s.endpoint.id),
  )
  const freshOptions: PlanOptions = {
    ...options,
    maxSlices: options.maxSlices
      ? options.maxSlices - previousPlan.slices.length
      : undefined,
  }
  const fullPlan = planCampaign(graphStore, freshOptions)
  const newSlices = fullPlan.slices.filter(s => !previousEndpoints.has(s.endpoint.id))

  return {
    slices: newSlices,
    coverage: {
      ...fullPlan.coverage,
      slicesPlanned: newSlices.length,
      slicesExecuted: 0,
      slicesConfirmed: 0,
    },
    generatedAt: Date.now(),
    options: freshOptions,
  }
}
