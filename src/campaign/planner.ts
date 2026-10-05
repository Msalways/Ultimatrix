/**
 * Campaign Planner — Phase 2 / T2.3
 *
 * Reads the knowledge graph (via GraphStore) and builds a coverage matrix:
 *
 *   endpoint × param × role × state × technique(primitive)
 *
 * Then decides per-cell relevance, prioritizes using analyser-derived
 * invariants + open research hypotheses, and dedupes equivalent cells into
 * CampaignSlice units of work.
 */

import { NodeType } from '../graph/schema'
import type {
  EndpointNode,
  AuthSchemeNode,
  RBACRoleNode,
  HypothesisNode,
  FactNode,
  WorkflowNode,
} from '../graph/schema'
import type { GraphStore } from '../graph/store'
import { getSignalFamilyTags } from '../orchestration/technique-planner'
import type {
  CampaignPlan,
  CampaignSlice,
  CoverageStats,
  PlanOptions,
  PrimitiveRef,
} from './types'
import { isTransportOrAssetUrl } from '../research/utils'
import { hasObservedWorkflowSequence } from '../research/types'

const DEFAULT_ROLE = 'anonymous'
const ANONYMOUS_ROLE = 'anonymous'
const AUTHENTICATED_ROLE = 'authenticated'
const BASELINE_STATE = 'baseline'

// Techniques that do not require a parameterized endpoint to be meaningful.
const GENERIC_TECHNIQUE_TAGS = ['recon', 'info-disclosure', 'information-disclosure', 'fingerprint', 'discovery']

// Techniques that only matter when the endpoint requires authentication.
const AUTH_TECHNIQUE_TAGS = ['auth', 'authorization', 'session', 'jwt', 'idor', 'privilege', 'bypass']

const STANDARD_HEADERS = new Set([
  'accept', 'accept-encoding', 'accept-language', 'authorization', 'cache-control',
  'connection', 'content-length', 'content-type', 'cookie', 'host', 'origin',
  'pragma', 'referer', 'user-agent',
])

interface EndpointContext {
  node: EndpointNode
  roles: string[]
  states: string[]
  inputs: Array<{ name: string; location: string; type?: string; required?: boolean }>
}

interface WorkflowContext {
  id: string
  steps: string[]
  terminalRequestId: string
  capturedAt?: number
}

function safeWorkflowStepLabel(step: WorkflowNode['properties']['steps'][number]): string {
  const method = step.method?.toUpperCase()
  let path = ''
  if (step.url) {
    try { path = new URL(step.url).pathname } catch { /* keep action/method only */ }
  }
  return [method ?? step.action, path].filter(Boolean).join(' ')
}

function terminalWorkflowContexts(
  workflows: WorkflowNode[],
  endpoints: EndpointNode[],
): Map<string, WorkflowContext> {
  const endpointById = new Map(endpoints.map(endpoint => [endpoint.id, endpoint]))
  const result = new Map<string, WorkflowContext>()
  for (const workflow of workflows) {
    const steps = workflow.properties.steps ?? []
    const capturedRequestIds = new Set(workflow.properties.capturedRequestIds ?? [])
    if (!hasObservedWorkflowSequence(workflow.properties)) continue

    const terminalStep = [...steps].reverse().find(step => {
      const endpoint = step.endpointId ? endpointById.get(step.endpointId) : undefined
      const method = (step.method ?? endpoint?.properties.method ?? '').toUpperCase()
      return Boolean(endpoint && step.requestId && capturedRequestIds.has(step.requestId))
        && method === String(endpoint?.properties.method ?? '').toUpperCase()
        && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    })
    const terminalId = terminalStep?.endpointId
    if (!terminalId || !terminalStep?.requestId || !endpointById.has(terminalId)) continue

    const existing = result.get(terminalId)
    if (!existing || (workflow.properties.capturedAt ?? 0) >= (existing.capturedAt ?? 0)) {
      result.set(terminalId, {
        id: workflow.id,
        steps: steps.map(safeWorkflowStepLabel),
        terminalRequestId: terminalStep.requestId,
        ...(workflow.properties.capturedAt !== undefined ? { capturedAt: workflow.properties.capturedAt } : {}),
      })
    }
  }
  return result
}

/** Structured, shape/typed-derived signals for a single endpoint. */
function endpointSignals(ep: EndpointNode): Set<string> {
  const out = new Set<string>()
  const method = (ep.properties.method ?? '').toUpperCase()
  const url = ep.properties.url ?? ''
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    out.add('state-changing')
  }
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()?.toLowerCase()
    if (last === 'graphql') out.add('graphql')
  } catch { /* not a URL */ }
  if (Array.isArray(ep.properties.tags) && ep.properties.tags.includes('graphql')) out.add('graphql')
  if (Array.isArray(ep.properties.tags) && ep.properties.tags.includes('serialized-content')) out.add('serialized-content')

  const headers = ep.properties.headers ? Object.keys(ep.properties.headers) : []
  const custom = headers.filter((h) => !STANDARD_HEADERS.has(h.toLowerCase()))
  if (custom.length > 0) out.add('custom-header')

  const params = ep.properties.params ?? []
  for (const p of params) {
    const tokens = (p?.name ?? '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[_\-.\s]+/)
      .filter(Boolean)
    const last = tokens[tokens.length - 1]
    if (last === 'id' || last === 'ids' || last === 'uuid' || last === 'guid') out.add('object-id-param')
    if (
      last === 'url' || last === 'uri' || last === 'href' || last === 'redirect' ||
      last === 'return' || last === 'callback' || last === 'webhook' || last === 'host' ||
      last === 'image' || last === 'file' || last === 'import' || last === 'metadata' ||
      last === 'fetch' || last === 'link' || last === 'target'
    ) {
      out.add('url-like-param')
    }
  }
  return out
}

/** Tags of this primitive that align with an endpoint's structured signals. */
function signalMatchedTags(primitive: PrimitiveRef, signals: Set<string>): string[] {
  const tags = primitive.tags ?? []
  const matched: string[] = []
  for (const s of signals) {
    const familyTags = getSignalFamilyTags(s)
    if (familyTags.length === 0) continue
    if (familyTags.some((t) => tags.includes(t))) matched.push(s)
  }
  return matched
}

function endpointInputs(ep: EndpointNode): EndpointContext['inputs'] {
  const inputs = new Map<string, EndpointContext['inputs'][number]>()
  for (const param of ep.properties.params ?? []) {
    const location = param.in || 'query'
    if (param.name) inputs.set(`${location}:${param.name}`, { name: param.name, location, type: param.type, required: param.required })
  }
  for (const name of Object.keys(ep.properties.headers ?? {})) {
    if (STANDARD_HEADERS.has(name.toLowerCase())) continue
    if (!inputs.has(`header:${name}`)) inputs.set(`header:${name}`, { name, location: 'header' })
  }
  return inputs.size ? [...inputs.values()] : [{ name: '', location: 'endpoint' }]
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

function actorVariants(role: string, options: PlanOptions): Array<{ actor: string; sessionRef?: string }> {
  if (role === ANONYMOUS_ROLE) return [{ actor: role }]
  const refs = [...new Set(options.actorSessions?.[role] ?? options.actorSessions?.authenticated ?? [])]
  return refs.length ? refs.map(sessionRef => ({ actor: sessionRef, sessionRef })) : [{ actor: role }]
}

function deriveStates(ep: EndpointNode): string[] {
  const preconditions = ep.properties.preconditions ?? []
  if (preconditions.length === 0) return [BASELINE_STATE]
  return [BASELINE_STATE, ...preconditions.map(p => `precondition:${p}`)]
}

function isTechniqueRelevant(
  primitive: PrimitiveRef,
  ep: EndpointNode,
  hasParams: boolean,
  signals: Set<string>,
): boolean {
  const tags = primitive.tags ?? []
  if (tags.some(t => GENERIC_TECHNIQUE_TAGS.includes(t))) return true
  // Strong signal-aligned routing: the primitive matches this endpoint's
  // structured surface (graphql / state-changing / object-id / url-like / …).
  if (signalMatchedTags(primitive, signals).length > 0) return true
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

  const endpoints = (graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]).filter(ep => {
    const method = String(ep.properties.method ?? 'GET').toUpperCase()
    if (isTransportOrAssetUrl(ep.properties.url, method)) return false
    // The site root is a document/navigation surface. With no observed input
    // or state-changing method it cannot support a meaningful primitive test.
    try {
      return !(method === 'GET' && new URL(ep.properties.url).pathname === '/' && (ep.properties.params ?? []).length === 0)
    } catch { return false }
  })
  const authSchemes = graphStore.queryNodes(NodeType.AUTH_SCHEME) as AuthSchemeNode[]
  const rbacRoles = graphStore.queryNodes(NodeType.RBAC_ROLE) as RBACRoleNode[]
  const hypotheses = (graphStore.queryNodes(NodeType.HYPOTHESIS) as HypothesisNode[]).filter(
    h => h.properties.status === 'open' || h.properties.status === 'planned',
  )
  const humanHypotheses = hypotheses.filter(h => h.properties.origin === 'human')
  const facts = graphStore.queryNodes(NodeType.FACT) as FactNode[]
  const workflowContexts = terminalWorkflowContexts(
    graphStore.queryNodes(NodeType.WORKFLOW) as WorkflowNode[],
    endpoints,
  )

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
    const roles = deriveRoles(ep, rbacRoles, includeAnonymous)
    return {
      node: ep,
      roles: roles.length ? roles : [defaultRole],
      states: deriveStates(ep),
      inputs: endpointInputs(ep),
    }
  })

  const roleFilter = options.roleFilter
  const stateFilter = options.stateFilter
  const techniqueFilter = options.techniqueFilter

  const slices: CampaignSlice[] = []
  const coveredEndpoints = new Set<string>()
  const coveredParams = new Set<string>()
  const coveredRoles = new Set<string>()
  const coveredActors = new Set<string>()
  const coveredStates = new Set<string>()
  const coveredTechniques = new Set<string>()

  for (const ctx of epContexts) {
    const ep = ctx.node
    const url = ep.properties.url
    const hasParams = ctx.inputs[0]?.location !== 'endpoint'
    const signals = endpointSignals(ep)
    const workflow = workflowContexts.get(ep.id)

    // Research hypotheses store endpoint node IDs; human-added hypotheses may
    // store URLs. Match both so the target model can affect campaign ordering.
    const hypBoost = hypotheses.filter(h => {
      const targets = h.properties.targetEndpoints ?? []
      return targets.includes(ep.id) || targets.includes(url)
    }).length
    const factBoost = facts.filter(f => f.properties.description.includes(url)).length

    for (const role of ctx.roles) {
      if (roleFilter && !roleFilter.includes(role)) continue
      for (const actor of actorVariants(role, options)) {
        for (const state of ctx.states) {
          if (stateFilter && !stateFilter.includes(state)) continue

          const relevantTechniques = primitives.filter(p => {
            if (techniqueFilter && !techniqueFilter.includes(p.id)) return false
            // A state-changing method alone does not establish a multi-step
            // workflow. Only the observed terminal action gets this probe.
            if (p.id === 'workflowBypass' && !workflow) return false
            return isTechniqueRelevant(p, ep, hasParams, signals)
          })
          if (relevantTechniques.length === 0) continue

          // Signal-aligned techniques get a routing boost (T6) so the campaign
          // favors primitives whose tags match this endpoint's real surface.
          const signalTechniqueIds = relevantTechniques
            .filter(p => signalMatchedTags(p, signals).length > 0)
            .map(p => p.id)
          const signalBoost = signalTechniqueIds.length > 0 ? 3 : 0

          let priority = 0
          if (role === AUTHENTICATED_ROLE || ep.properties.authType) priority += 2
          if (hasParams) priority += 1
          priority += Math.min(6, hypBoost * 3)
          priority += Math.min(3, factBoost)
          if (state !== BASELINE_STATE) priority += 1
          if (reusedEndpoints.has(url)) priority += 1
          if (valueOriginEndpoints.has(ep.id)) priority += 2
          if (workflow) priority += 3
          priority += signalBoost

          const reasonBits: string[] = []
          if (hypBoost) reasonBits.push(`Research hypotheses target this endpoint (${hypBoost})`)
          if (ep.properties.authType) reasonBits.push(`auth:${ep.properties.authType}`)
          if (hasParams) reasonBits.push(`${ctx.inputs.length} input(s)`)
          if (signalTechniqueIds.length > 0) reasonBits.push(`signals: ${[...signals].slice(0, 5).join(', ')}`)
          if (signalBoost) reasonBits.push(`${signalTechniqueIds.length} signal-aligned technique(s)`)
          if (workflow) reasonBits.push(`observed workflow ${workflow.id} (${workflow.steps.length} steps)`)
          for (const primitive of relevantTechniques) {
            // Workflow bypass replays the captured terminal action as one
            // endpoint-scoped unit; parameter mutation is a separate test.
            const primitiveInputs = primitive.id === 'workflowBypass'
              ? [{ name: '', location: 'endpoint' }]
              : ctx.inputs
            for (const input of primitiveInputs) {
              const inputId = encodeURIComponent(`${input.location}:${input.name}`)
              const actorId = encodeURIComponent(actor.sessionRef ?? actor.actor)
              slices.push({
                id: `slice:${ep.id}:${inputId}:${encodeURIComponent(role)}:${actorId}:${encodeURIComponent(state)}:${encodeURIComponent(primitive.id)}`,
                endpoint: { id: ep.id, url, method: ep.properties.method },
                input,
                params: input.name ? [input.name] : [],
                role,
                actor: actor.actor,
                ...(actor.sessionRef ? { sessionRef: actor.sessionRef } : {}),
                state,
                ...(primitive.id === 'workflowBypass' && workflow
                  ? {
                    workflowId: workflow.id,
                    workflowSteps: [...workflow.steps],
                    workflowTerminalRequestId: workflow.terminalRequestId,
                  }
                  : {}),
                techniqueIds: [primitive.id],
                domains: primitive.domains ?? [],
                priority: priority + (signalTechniqueIds.includes(primitive.id) ? 1 : 0),
                reason: reasonBits.join('; ') || undefined,
              })
              coveredEndpoints.add(ep.id)
              if (input.name) coveredParams.add(`${ep.id}#${input.location}:${input.name}`)
              coveredRoles.add(role)
              coveredActors.add(actor.actor)
              coveredStates.add(state)
              coveredTechniques.add(primitive.id)
            }
          }
        }
      }
    }
  }

  slices.sort((a, b) => b.priority - a.priority)

  coveredEndpoints.clear()
  coveredParams.clear()
  coveredRoles.clear()
  coveredActors.clear()
  coveredStates.clear()
  coveredTechniques.clear()
  for (const slice of slices) {
    coveredEndpoints.add(slice.endpoint.id)
    if (slice.input?.name) coveredParams.add(`${slice.endpoint.id}#${slice.input.location}:${slice.input.name}`)
    coveredRoles.add(slice.role)
    coveredActors.add(slice.actor ?? slice.role)
    coveredStates.add(slice.state)
    slice.techniqueIds.forEach(id => coveredTechniques.add(id))
  }

  const totalParams = epContexts.reduce((acc, c) => acc + c.inputs.filter(input => input.name).length, 0)
  const allRoles = new Set<string>()
  const allActors = new Set<string>()
  for (const c of epContexts) c.roles.forEach(r => {
    allRoles.add(r)
    actorVariants(r, options).forEach(actor => allActors.add(actor.actor))
  })
  const allStates = new Set<string>()
  for (const c of epContexts) c.states.forEach(s => allStates.add(s))

  const coverage: CoverageStats = {
    endpointsTotal: endpoints.length,
    endpointsCovered: coveredEndpoints.size,
    paramsTotal: totalParams,
    paramsCovered: coveredParams.size,
    rolesTotal: allRoles.size,
    rolesCovered: coveredRoles.size,
    actorsTotal: allActors.size,
    actorsCovered: coveredActors.size,
    statesTotal: allStates.size,
    statesCovered: coveredStates.size,
    techniquesTotal: primitives.length,
    techniquesPlanned: coveredTechniques.size,
    slicesPlanned: slices.length,
    slicesExecuted: 0,
    slicesConfirmed: 0,
    humanHypothesesConsidered: humanHypotheses.length,
  }

  const domains = new Set(options.domainNames ?? primitives.flatMap(primitive => primitive.domains ?? []))
  const domainResults = [...domains].sort().map(domain => {
    const domainPrimitives = primitives.filter(primitive => primitive.domains?.includes(domain))
    const declaredPrimitiveIds = options.domainPrimitiveIds?.[domain] ?? domainPrimitives.map(primitive => primitive.id)
    const domainSlices = slices.filter(slice => slice.domains?.includes(domain))
    return {
      domain,
      status: declaredPrimitiveIds.length === 0
        ? 'skipped' as const
        : domainPrimitives.length === 0
          ? 'blocked' as const
        : endpoints.length === 0
          ? 'blocked' as const
          : domainSlices.length === 0
            ? 'not_applicable' as const
            : 'skipped' as const,
      unitsPlanned: domainSlices.length,
      unitsCompleted: 0,
      ...(declaredPrimitiveIds.length === 0
        ? { reason: 'No campaign primitive is mapped from the live skill registry.' }
        : domainPrimitives.length === 0
          ? { reason: `Unavailable campaign primitive(s): ${declaredPrimitiveIds.join(', ')}.` }
        : endpoints.length === 0
          ? { reason: 'No target endpoints were discovered.' }
          : domainSlices.length === 0
            ? { reason: "No discovered endpoint matches this domain's declared primitives." }
            : { reason: 'Campaign units are planned and awaiting execution.' }),
    }
  })

  return {
    slices,
    coverage,
    domains: domainResults,
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
    domains: fullPlan.domains?.map(domain => {
      const unitsPlanned = newSlices.filter(slice => slice.domains?.includes(domain.domain)).length
      return {
        ...domain,
        unitsPlanned,
        unitsCompleted: 0,
        status: unitsPlanned ? 'skipped' as const : 'not_applicable' as const,
        reason: unitsPlanned
          ? 'New coverage units are planned and awaiting execution.'
          : 'No new endpoint, input, actor, state, or technique unit was added for this domain.',
      }
    }),
    generatedAt: Date.now(),
    options: freshOptions,
  }
}
