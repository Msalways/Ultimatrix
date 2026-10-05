import { NodeType, type EndpointNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { CapturedRequest } from '../capture/captured-request-store'
import type { BusinessRuleObservation, ResearchEntity, ResearchHypothesis, ResearchWorkflow } from './types'
import { hasObservedWorkflowSequence } from './types'
import { looksLikeId, MIN_REFLECTION_VALUE_LENGTH, isTransportOrAssetUrl, stableId } from './utils'

/** Case-insensitive response-header lookup (fetch lowercases; HAR preserves case). */
function responseHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

function endpointById(store: GraphStore): Map<string, EndpointNode> {
  return new Map((store.queryNodes(NodeType.ENDPOINT) as EndpointNode[]).map(e => [e.id, e]))
}

/**
 * An endpoint is an IDOR candidate when it is addressed by a structured object
 * identifier — derived from value SHAPE (numeric / hex / uuid), never from a
 * keyword list. We cross-reference the entity's already-extracted id segments
 * (typed upstream) and also check param/body field names by shape.
 */
function hasIdSignal(endpoint: EndpointNode, entityIds: Set<string>): boolean {
  const url = endpoint.properties.url
  let pathSegments: string[]
  try {
    pathSegments = new URL(url).pathname.split('/').filter(Boolean)
  } catch {
    pathSegments = []
  }
  const idInPath = pathSegments.some(s => looksLikeId(s) || entityIds.has(s))
  if (idInPath) return true

  const params = endpoint.properties.params || []
  const idInParams = params.some(p => looksLikeId(p.name) || entityIds.has(p.name))
  if (idInParams) return true

  return false
}

function mutating(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())
}

function hasAuthSignal(endpoint: EndpointNode): boolean {
  const props = endpoint.properties as Record<string, any>
  if (props.authRequired || props.requiresAuth) return true
  const headers = props.headers && typeof props.headers === 'object' ? Object.keys(props.headers) : []
  return headers.some(name => /authorization|cookie|token|csrf/i.test(name))
}

function isMetadataEndpoint(endpoint: EndpointNode): boolean {
  return isTransportOrAssetUrl(endpoint.properties.url, endpoint.properties.method)
}

/** Keep hypothesis generation focused on application behavior, not assets or
 * anonymous metadata endpoints that cannot demonstrate a bounty-impacting
 * authorization or workflow failure. This is shape-based and target-agnostic.
 */
function isHighValueEndpoint(endpoint: EndpointNode): boolean {
  const props = endpoint.properties as Record<string, any>
  const tags = Array.isArray(props.tags) ? props.tags.map((tag: unknown) => String(tag)) : []
  // JavaScript mining is useful workflow intelligence, but a route found only
  // in a static bundle is not evidence that the target serves it. Require a
  // runtime correlation marker before it can drive an active hypothesis.
  if (tags.includes('js-mined') && !tags.includes('js-correlated')) return false
  const method = String(props.method ?? 'GET').toUpperCase()
  if (isMetadataEndpoint(endpoint)) return false
  if (mutating(method)) return true
  if (Array.isArray(props.params) && props.params.length > 0) return true
  if (props.bodySchema || props.requiresAuth || props.authRequired) return true
  const headers = props.headers && typeof props.headers === 'object' ? Object.keys(props.headers) : []
  if (headers.some(name => /authorization|cookie|token|csrf/i.test(name))) return true
  try {
    const path = new URL(String(props.url)).pathname.toLowerCase()
    return !/\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|webp|pdf|zip)$/.test(path)
      && /\/api\/|\/rest\/|\/graphql|\/user|\/account|\/order|\/basket|\/admin/i.test(path)
  } catch {
    return false
  }
}

const LIMIT_COUNT: Record<string, number> = {
  one: 1,
  'a single': 1,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
}

/** Only recognize explicit, bounded target statements; do not infer a default limit. */
function explicitActionLimit(body: string): { allowedCount: number; ruleText: string } | undefined {
  const patterns = [
    /\b(?:only|maximum|max(?:imum)?(?:\s+of)?|at\s+most|no\s+more\s+than|up\s+to|limit(?:ed)?\s+(?:to|of))\s+(one|a single|[1-9])\s+(?:time|use|redemption|claim|attempt|purchase|transfer|transaction|booking|request|submission|item|coupon|offer|reward|voucher)s?\b/ig,
    /\b(?:can|may)(?:\s+only)?\s+(?:be\s+)?(?:used|redeemed|claimed|applied)\s+once\b/ig,
    /\bonly\s+once\s+per\s+(?:user|account|customer|order|campaign)\b/ig,
    /\b(?:one|a single)\s+(?:use|redemption|claim|attempt)\s+per\s+(?:user|account|customer|order|campaign)\b/ig,
    /\b(?:one[-\s]?time|single[-\s]?use)\b/ig,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(body)
    if (!match) continue
    const countText = match[1]?.toLowerCase()
    return { allowedCount: countText ? LIMIT_COUNT[countText] : 1, ruleText: match[0] }
  }
  return undefined
}

function sameObservedWorkflow(
  workflow: ResearchWorkflow,
  firstCaptureId: string,
  secondCaptureId: string,
): boolean {
  if (!hasObservedWorkflowSequence(workflow)) return false
  const ids = new Set([
    ...(workflow.capturedRequestIds ?? []),
    ...workflow.steps.map(step => step.requestId).filter((id): id is string => Boolean(id)),
  ])
  return ids.has(firstCaptureId) && ids.has(secondCaptureId)
}

function actionLimitHypotheses(
  store: GraphStore,
  workflows: ResearchWorkflow[],
  captured: CapturedRequest[],
): ResearchHypothesis[] {
  const endpoints = endpointById(store)
  const byRoute = new Map<string, EndpointNode>()
  for (const endpoint of endpoints.values()) {
    const key = endpointKey(endpoint.properties.url)
    if (key && isHighValueEndpoint(endpoint)) {
      byRoute.set(`${endpoint.properties.method.toUpperCase()}:${key}`, endpoint)
    }
  }

  const ruleCaptures = captured.flatMap(entry => {
    if (!entry.url || entry.status == null || entry.status < 200 || entry.status >= 300 || !entry.responseBody) return []
    const rule = explicitActionLimit(entry.responseBody.slice(0, 100_000))
    return rule ? [{ entry, ...rule }] : []
  })
  const actions = captured.filter(entry =>
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method.toUpperCase())
      && entry.status != null && entry.status >= 200 && entry.status < 300,
  )
  const out: ResearchHypothesis[] = []

  for (const rule of ruleCaptures) {
    const ruleRoute = endpointKey(rule.entry.url)
    if (!ruleRoute) continue
    for (const action of actions) {
      const actionRoute = endpointKey(action.url)
      if (!actionRoute) continue
      let sameOrigin = false
      try { sameOrigin = new URL(rule.entry.url).origin === new URL(action.url).origin } catch { /* invalid URLs are not candidates */ }
      if (!sameOrigin) continue
      const workflow = workflows.find(item => sameObservedWorkflow(item, rule.entry.id, action.id))
      if (ruleRoute !== actionRoute && !workflow) continue
      const endpoint = byRoute.get(`${action.method.toUpperCase()}:${actionRoute}`)
      const businessRule: BusinessRuleObservation = {
        kind: 'action_limit',
        allowedCount: rule.allowedCount,
        actionRequestId: action.id,
        actionMethod: action.method.toUpperCase(),
        actionUrl: action.url,
        ruleCaptureId: rule.entry.id,
        ruleUrl: rule.entry.url,
        ruleText: rule.ruleText,
      }
      out.push({
        id: stableId('hypothesis', ['action-limit', action.id, rule.entry.id, rule.ruleText]),
        title: `Observed action limit of ${rule.allowedCount} may be unenforced`,
        kind: 'action_limit',
        reason: `Captured target response ${rule.entry.id} states “${rule.ruleText}”; captured state-changing request ${action.id} is on the same route${workflow ? ` in observed workflow ${workflow.id}` : ''}. Verify the actor, state baseline, and post-limit state before reporting impact.`,
        targetEndpoints: endpoint ? [endpoint.id] : [],
        relatedWorkflowIds: workflow ? [workflow.id] : [],
        relatedEntityIds: [],
        requiredSetup: [
          `Use captured request ${action.id} as the state-changing action`,
          'Capture a same-actor JSON state baseline and record its evidence',
          'Verify the exact target-stated limit before bounded replay',
        ],
        businessRule,
        risk: 'medium',
        confidence: 0.62,
        status: 'open',
      })
    }
  }
  return out
}

/**
 * Risk for a workflow is derived from STRUCTURED signals — whether it touched
 * roles or required auth — not from scanning the workflow name for keywords.
 */
function workflowRisk(workflow: ResearchWorkflow): 'high' | 'medium' {
  return workflow.observedRoles.length > 0 || workflow.requiredAuth ? 'high' : 'medium'
}

export function generateHypotheses(
  store: GraphStore,
  workflows: ResearchWorkflow[],
  entities: ResearchEntity[],
  captured: CapturedRequest[] = [],
): ResearchHypothesis[] {
  const endpoints = endpointById(store)
  const hypotheses: ResearchHypothesis[] = []

  for (const entity of entities) {
    const entityEndpoints = entity.endpoints.map(id => endpoints.get(id)).filter((e): e is EndpointNode => Boolean(e))
    const idSet = new Set(entity.ids)
    const idEndpoints = entityEndpoints.filter(e => isHighValueEndpoint(e) && hasIdSignal(e, idSet))
    if (idEndpoints.length > 0) {
      hypotheses.push({
        id: stableId('hypothesis', ['idor', entity.id, idEndpoints.map(e => e.id).join(',')]),
        title: `${entity.name} objects may be accessible across users`,
        kind: 'idor',
        reason: 'Endpoint shape contains object identifiers. Bug bounty value usually comes from cross-user object comparison, not payload fuzzing.',
        targetEndpoints: idEndpoints.map(e => e.id),
        relatedWorkflowIds: workflows.filter(w => w.relatedEndpoints.some(id => entity.endpoints.includes(id))).map(w => w.id),
        relatedEntityIds: [entity.id],
        requiredSetup: ['Two authenticated actors with distinct objects'],
        risk: 'high',
        confidence: 0.55,
        status: 'open',
      })
    }

    const massAssignmentEndpoints = entityEndpoints.filter(e => isHighValueEndpoint(e) && mutating(e.properties.method) && (entity.roleFields.length > 0 || entity.ownerFields.length > 0))
    if (massAssignmentEndpoints.length > 0) {
      hypotheses.push({
        id: stableId('hypothesis', ['mass-assignment', entity.id]),
        title: `${entity.name} update endpoints may accept server-controlled fields`,
        kind: 'mass_assignment',
        reason: `Mutating endpoints expose owner/role-like fields: ${[...entity.ownerFields, ...entity.roleFields].join(', ')}`,
        targetEndpoints: massAssignmentEndpoints.map(e => e.id),
        relatedWorkflowIds: workflows.filter(w => w.relatedEndpoints.some(id => entity.endpoints.includes(id))).map(w => w.id),
        relatedEntityIds: [entity.id],
        requiredSetup: ['Authenticated actor with a normal role', 'Known mutable object'],
        risk: 'high',
        confidence: 0.5,
        status: 'open',
      })
    }

    const disclosureEndpoints = entityEndpoints.filter(e => isHighValueEndpoint(e) && entity.sensitiveFields.length > 0)
    if (disclosureEndpoints.length > 0) {
      hypotheses.push({
        id: stableId('hypothesis', ['info-disclosure', entity.id]),
        title: `${entity.name} responses may expose sensitive fields`,
        kind: 'information_disclosure',
        reason: `Entity has sensitive-looking fields. Compare responses across auth states and roles.`,
        targetEndpoints: disclosureEndpoints.map(e => e.id),
        relatedWorkflowIds: workflows.filter(w => w.relatedEndpoints.some(id => entity.endpoints.includes(id))).map(w => w.id),
        relatedEntityIds: [entity.id],
        requiredSetup: ['Logged-out request', 'Logged-in request', 'Optional second actor'],
        risk: 'medium',
        confidence: 0.45,
        status: 'open',
      })
    }
  }

  for (const workflow of workflows) {
    const highValueEndpointIds = workflow.relatedEndpoints.filter(id => {
      const endpoint = endpoints.get(id)
      return endpoint ? isHighValueEndpoint(endpoint) : false
    })
    const hasStructuredWorkflowSignal = workflow.relatedEndpoints.length === 0 || workflow.requiredAuth
      || workflow.observedRoles.length > 0
      || workflow.stateChanges.length > 0
      || workflow.inputFields.length > 0
    // Workflows without endpoint relations are retained for backward
    // compatibility; the runtime can resolve their requests later. When
    // relations exist, require at least one high-value application endpoint.
    const endpointEvidenceAvailable = workflow.relatedEndpoints.length === 0 || highValueEndpointIds.length > 0
    // A route cluster is useful target context, but its graph iteration order
    // is not an observed sequence. Only operator traces with multiple captured
    // requests can ground skip/replay hypotheses. Keep legacy caller-provided
    // workflows usable when they have no explicit inferred provenance.
    const sequenceCanBeTested = workflow.source
      ? hasObservedWorkflowSequence(workflow)
      : workflow.steps.length >= 2 || workflow.stateChanges.length > 0
    if (sequenceCanBeTested && endpointEvidenceAvailable && hasStructuredWorkflowSignal) {
      hypotheses.push({
        id: stableId('hypothesis', ['workflow-bypass', workflow.id]),
        title: `${workflow.name} may be bypassable by direct API replay or step skipping`,
        kind: 'workflow_bypass',
        reason: workflow.sequenceObserved
          ? 'Multiple requests were observed in this ordered workflow. Test replay and step skipping against a fresh baseline state.'
          : 'Workflow structure suggests stateful behavior. Verify the intended transition before testing replay or step skipping.',
        targetEndpoints: highValueEndpointIds,
        relatedWorkflowIds: [workflow.id],
        relatedEntityIds: entities.filter(e => e.endpoints.some(id => workflow.relatedEndpoints.includes(id))).map(e => e.id),
        requiredSetup: ['Replayable request from the normal UI flow'],
        risk: workflowRisk(workflow),
        confidence: 0.48,
        status: 'open',
      })
    }
  }

  // An explicit target-stated usage rule plus a successful observed state-
  // changing request is actionable learning. The resulting item is only a
  // hypothesis; the campaign still needs an actor-matched state baseline.
  hypotheses.push(...actionLimitHypotheses(store, workflows, captured))

  // Endpoint-native hypotheses close the extraction gap: a route can be
  // actionable even when entity/workflow extraction has not recognized its
  // domain model yet. Signals come from captured request structure only.
  const sqlInjectionRoutes = new Set<string>()
  for (const endpoint of endpoints.values()) {
    if (!isHighValueEndpoint(endpoint)) continue
    const props = endpoint.properties
    const idSignal = hasIdSignal(endpoint, new Set())
    const authSignal = hasAuthSignal(endpoint)
    const inputSignal = (Array.isArray(props.params) && props.params.length > 0) || Boolean(props.bodySchema)
    const queryInputs = (props.params ?? [])
      .filter(param => param.in === 'query')
      .map(param => param.name)
    const hasCapturedRoute = Array.isArray((props as Record<string, any>).tags)
      && (props as Record<string, any>).tags.includes('har-capture')
    const routeKey = `${String(props.method).toUpperCase()}:${endpointKey(props.url) ?? props.url}`
    if (hasCapturedRoute && String(props.method).toUpperCase() === 'GET' && queryInputs.length > 0 && !sqlInjectionRoutes.has(routeKey)) {
      sqlInjectionRoutes.add(routeKey)
      hypotheses.push({
        id: stableId('hypothesis', ['sql-injection', endpoint.id, queryInputs.join(',')]),
        title: 'Observed query input may alter database query behavior',
        kind: 'sql_injection',
        reason: 'A target response exposed a string query input. Compare a benign UI-captured value against a bounded boolean SQL expression and require a stable collection-size oracle before promotion.',
        targetEndpoints: [endpoint.id],
        targetParams: queryInputs,
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['Capture a non-empty benign input through the target UI', 'Anonymous baseline and independent retest'],
        risk: 'medium',
        confidence: 0.5,
        status: 'open',
      })
    }
    if (idSignal && authSignal) {
      hypotheses.push({
        id: stableId('hypothesis', ['endpoint-access-control', endpoint.id]),
        title: 'Captured object endpoint may not enforce object authorization',
        kind: 'broken_access_control',
        reason: 'The captured route contains a structured identifier and authentication material; compare access to a different identifier under a separate actor.',
        targetEndpoints: [endpoint.id],
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['Two authenticated actors or a second object identifier'],
        risk: 'high',
        confidence: 0.52,
        status: 'open',
      })
    } else if (mutating(props.method) && inputSignal) {
      hypotheses.push({
        id: stableId('hypothesis', ['endpoint-input-integrity', endpoint.id]),
        title: 'Captured state-changing endpoint may accept uncontrolled fields',
        kind: 'mass_assignment',
        reason: 'The captured request mutates server state and carries structured input; test whether additional fields are accepted or persisted.',
        targetEndpoints: [endpoint.id],
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['A valid captured state-changing request'],
        risk: 'medium',
        confidence: 0.42,
        status: 'open',
      })
    } else if (authSignal && inputSignal) {
      hypotheses.push({
        id: stableId('hypothesis', ['endpoint-disclosure', endpoint.id]),
        title: 'Authenticated parameterized endpoint may disclose data across access states',
        kind: 'information_disclosure',
        reason: 'The captured route uses authentication and structured inputs; compare its response under logged-out and lower-privilege contexts.',
        targetEndpoints: [endpoint.id],
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['Authenticated baseline and unauthenticated comparison'],
        risk: 'medium',
        confidence: 0.38,
        status: 'open',
      })
    }
  }

  // Reflection-driven hypotheses close the injection gap: an endpoint can
  // be actionable from observed traffic alone, with no entity, workflow,
  // auth, or mutation signal. Captured echo evidence feeds the planner the
  // same way extracted structure does.
  hypotheses.push(...reflectionHypotheses(store, captured))

  // Location-echo hypotheses close the redirect gap the same way: a
  // request-supplied value observed verbatim in a 3xx Location header is
  // structural evidence of an unvalidated redirect sink.
  hypotheses.push(...redirectHypotheses(store, captured))

  const seen = new Set<string>()
  const deduped = hypotheses.filter(h => {
    if (seen.has(h.id)) return false
    seen.add(h.id)
    return true
  }).sort((a, b) => b.confidence - a.confidence)
  return deduped
}

/**
 * Bound a ranked hypothesis list to `max` entries WITHOUT starving whole
 * attack classes. A flat top-N slice lets one prolific speculative kind
 * (e.g. dozens of workflow_bypass at identical confidence) evict the only
 * capture-backed hypothesis in the queue — exactly the evidence that
 * deserves testing first. Round-robin across kinds (kinds ordered by their
 * top confidence, highest-confidence first within each kind) so every
 * represented class survives the cap.
 */
export function selectHypotheses(
  ranked: ResearchHypothesis[],
  max: number,
): ResearchHypothesis[] {
  const limit = Math.max(0, Math.floor(max))
  if (ranked.length <= limit) return [...ranked]
  if (limit === 0) return []
  const byKind = new Map<string, ResearchHypothesis[]>()
  for (const h of ranked) {
    const group = byKind.get(h.kind)
    if (group) group.push(h)
    else byKind.set(h.kind, [h])
  }
  const kinds = [...byKind.keys()].sort((a, b) => {
    const topA = byKind.get(a)?.[0]?.confidence ?? 0
    const topB = byKind.get(b)?.[0]?.confidence ?? 0
    if (topB !== topA) return topB - topA
    return a < b ? -1 : a > b ? 1 : 0
  })
  const out: ResearchHypothesis[] = []
  let progress = true
  while (out.length < limit && progress) {
    progress = false
    for (const kind of kinds) {
      if (out.length >= limit) break
      const group = byKind.get(kind)
      const next = group?.shift()
      if (next) {
        out.push(next)
        progress = true
      }
    }
  }
  return out
}

/**
 * A request-supplied query value echoed verbatim into the response body is
 * structural evidence of reflection — the definition of a reflected-
 * injection sink. The signal is value containment (shape), never a keyword
 * or payload-pattern match: any sufficiently long value counts, including
 * benign probes. Short values are ignored as coincidental collisions.
 */
function endpointKey(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.origin}${path}`
  } catch {
    return undefined
  }
}

export function findReflectedParams(
  captured: CapturedRequest[],
  maxEntries = 300,
  maxBodyChars = 100_000,
): Array<{ entry: CapturedRequest; params: string[] }> {
  const out: Array<{ entry: CapturedRequest; params: string[] }> = []
  for (const entry of captured.slice(0, maxEntries)) {
    if (!entry?.url || typeof entry.responseBody !== 'string' || entry.responseBody.length === 0) continue
    let query: URLSearchParams
    try {
      query = new URL(entry.url).searchParams
    } catch {
      continue
    }
    const names = [...query.keys()]
    if (names.length === 0) continue
    const body = entry.responseBody.slice(0, maxBodyChars)
    const echoed = names.filter(name => {
      const value = query.get(name) ?? ''
      return value.length >= MIN_REFLECTION_VALUE_LENGTH && body.includes(value)
    })
    if (echoed.length > 0) out.push({ entry, params: [...new Set(echoed)].sort() })
  }
  return out
}

export function reflectionHypotheses(
  store: GraphStore,
  captured: CapturedRequest[],
): ResearchHypothesis[] {
  const endpoints = endpointById(store)
  const byKey = new Map<string, EndpointNode>()
  for (const endpoint of endpoints.values()) {
    const key = endpointKey(endpoint.properties.url)
    if (key) byKey.set(key, endpoint)
  }
  const hypotheses: ResearchHypothesis[] = []
  const seenUnmapped = new Set<string>()
  for (const { entry, params } of findReflectedParams(captured)) {
    const key = endpointKey(entry.url)
    const endpoint = key ? byKey.get(key) : undefined
    if (endpoint && isHighValueEndpoint(endpoint)) {
      hypotheses.push({
        id: stableId('hypothesis', ['reflected-injection', endpoint.id, params.join(',')]),
        title: 'Query parameters echoed into responses may allow reflected injection',
        kind: 'reflected_injection',
        reason: 'A request-supplied query value was observed verbatim in the response body. Send a unique marker and check whether it is echoed back unencoded.',
        targetEndpoints: [endpoint.id],
        targetParams: params,
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['Single anonymous request with a unique marker'],
        risk: 'high',
        confidence: 0.55,
        status: 'open',
      })
      continue
    }
    // Unmapped echo: the capture is real evidence even though the graph has
    // not indexed the route yet. Emit without a target endpoint so the
    // planner still yields an entryId-driven experiment; the researcher
    // supplies the captured request id at execution time. Deduplicated per
    // route so spider noise cannot flood the queue.
    if (key && !seenUnmapped.has(key) && !endpoint) {
      seenUnmapped.add(key)
      hypotheses.push({
        id: stableId('hypothesis', ['reflected-injection-unmapped', key, params.join(',')]),
        title: 'Unmapped route echoes query parameters into responses',
        kind: 'reflected_injection',
        reason: 'A request-supplied query value was observed verbatim in the response body on a route the graph has not indexed. Persist the endpoint or execute via the captured request id.',
        targetEndpoints: [],
        targetParams: params,
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['Captured request id for the echoing request', 'Single anonymous request with a unique marker'],
        risk: 'medium',
        confidence: 0.45,
        status: 'open',
      })
    }
  }
  return hypotheses
}

/**
 * A request-supplied query value echoed verbatim into a 3xx Location
 * header is structural evidence of an unvalidated redirect sink — the
 * redirect analogue of a reflected-injection echo. Shape-based (value
 * containment), never param-name matching: any sufficiently long value
 * counts. Short values are ignored as coincidental collisions.
 */
export function findLocationEchoes(
  captured: CapturedRequest[],
  maxEntries = 300,
): Array<{ entry: CapturedRequest; params: string[] }> {
  const out: Array<{ entry: CapturedRequest; params: string[] }> = []
  for (const entry of captured.slice(0, maxEntries)) {
    if (!entry?.url) continue
    const location = responseHeader(entry.responseHeaders, 'location')
    if (!location) continue
    let query: URLSearchParams
    try {
      query = new URL(entry.url).searchParams
    } catch {
      continue
    }
    const names = [...query.keys()]
    if (names.length === 0) continue
    const echoed = names.filter(name => {
      const value = query.get(name) ?? ''
      return value.length >= MIN_REFLECTION_VALUE_LENGTH && location.includes(value)
    })
    if (echoed.length > 0) out.push({ entry, params: [...new Set(echoed)].sort() })
  }
  return out
}

export function redirectHypotheses(
  store: GraphStore,
  captured: CapturedRequest[],
): ResearchHypothesis[] {
  const endpoints = endpointById(store)
  const byKey = new Map<string, EndpointNode>()
  for (const endpoint of endpoints.values()) {
    const key = endpointKey(endpoint.properties.url)
    if (key) byKey.set(key, endpoint)
  }
  const hypotheses: ResearchHypothesis[] = []
  const seenUnmapped = new Set<string>()
  for (const { entry, params } of findLocationEchoes(captured)) {
    const key = endpointKey(entry.url)
    const endpoint = key ? byKey.get(key) : undefined
    if (endpoint && isHighValueEndpoint(endpoint)) {
      hypotheses.push({
        id: stableId('hypothesis', ['open-redirect', endpoint.id, params.join(',')]),
        title: 'Redirect destination from query parameters may be unvalidated',
        kind: 'open_redirect',
        reason: 'A request-supplied query value was observed verbatim in the 3xx Location header. Swap it for a unique marker URL and check whether Location echoes it.',
        targetEndpoints: [endpoint.id],
        targetParams: params,
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['Single anonymous request with a unique marker URL'],
        risk: 'high',
        confidence: 0.55,
        status: 'open',
      })
      continue
    }
    if (key && !seenUnmapped.has(key) && !endpoint) {
      seenUnmapped.add(key)
      hypotheses.push({
        id: stableId('hypothesis', ['open-redirect-unmapped', key, params.join(',')]),
        title: 'Unmapped route reflects query parameters into redirect targets',
        kind: 'open_redirect',
        reason: 'A request-supplied query value was observed verbatim in the 3xx Location header on a route the graph has not indexed. Persist the endpoint or execute via the captured request id.',
        targetEndpoints: [],
        targetParams: params,
        relatedWorkflowIds: [],
        relatedEntityIds: [],
        requiredSetup: ['Captured request id for the echoing request', 'Single anonymous request with a unique marker URL'],
        risk: 'medium',
        confidence: 0.45,
        status: 'open',
      })
    }
  }
  return hypotheses
}
