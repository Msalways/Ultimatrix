import { NodeType, type EndpointNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { ResearchEntity, ResearchHypothesis, ResearchWorkflow } from './types'
import { looksLikeId, stableId } from './utils'

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
  try {
    const pathname = new URL(endpoint.properties.url).pathname.toLowerCase()
    // Transport handshakes are not application workflows, regardless of
    // method. They otherwise dominate discovery because browsers emit many
    // polling requests for them.
    if (/(?:^|\/)(?:socket\.io|sockjs)(?:\/|$)/.test(pathname)) return true
    if (String(endpoint.properties.method).toUpperCase() !== 'GET') return false
    const last = pathname.split('/').filter(Boolean).pop() ?? ''
    return /(?:^|[-_])(?:health|healthz|ready|readiness|liveness|version|configuration|config|docs?|swagger|openapi|status)$/.test(last)
  } catch {
    return false
  }
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
    if ((workflow.steps.length >= 2 || workflow.stateChanges.length > 0) && endpointEvidenceAvailable && hasStructuredWorkflowSignal) {
      hypotheses.push({
        id: stableId('hypothesis', ['workflow-bypass', workflow.id]),
        title: `${workflow.name} may be bypassable by direct API replay or step skipping`,
        kind: 'workflow_bypass',
        reason: 'Workflow has state-changing behavior. Direct API replay and step skipping often reveal business logic bugs.',
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

  // Endpoint-native hypotheses close the extraction gap: a route can be
  // actionable even when entity/workflow extraction has not recognized its
  // domain model yet. Signals come from captured request structure only.
  for (const endpoint of endpoints.values()) {
    if (!isHighValueEndpoint(endpoint)) continue
    const props = endpoint.properties
    const idSignal = hasIdSignal(endpoint, new Set())
    const authSignal = hasAuthSignal(endpoint)
    const inputSignal = (Array.isArray(props.params) && props.params.length > 0) || Boolean(props.bodySchema)
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

  const seen = new Set<string>()
  return hypotheses.filter(h => {
    if (seen.has(h.id)) return false
    seen.add(h.id)
    return true
  }).sort((a, b) => b.confidence - a.confidence)
}
