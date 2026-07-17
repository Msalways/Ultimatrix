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
  let pathSegments: string[] = []
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
    const idEndpoints = entityEndpoints.filter(e => hasIdSignal(e, idSet))
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

    const massAssignmentEndpoints = entityEndpoints.filter(e => mutating(e.properties.method) && (entity.roleFields.length > 0 || entity.ownerFields.length > 0))
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

    const disclosureEndpoints = entityEndpoints.filter(e => entity.sensitiveFields.length > 0)
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
    if (workflow.steps.length >= 2 || workflow.stateChanges.length > 0) {
      hypotheses.push({
        id: stableId('hypothesis', ['workflow-bypass', workflow.id]),
        title: `${workflow.name} may be bypassable by direct API replay or step skipping`,
        kind: 'workflow_bypass',
        reason: 'Workflow has state-changing behavior. Direct API replay and step skipping often reveal business logic bugs.',
        targetEndpoints: workflow.relatedEndpoints,
        relatedWorkflowIds: [workflow.id],
        relatedEntityIds: entities.filter(e => e.endpoints.some(id => workflow.relatedEndpoints.includes(id))).map(e => e.id),
        requiredSetup: ['Replayable request from the normal UI flow'],
        risk: workflowRisk(workflow),
        confidence: 0.48,
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
