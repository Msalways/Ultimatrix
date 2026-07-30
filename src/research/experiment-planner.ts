import {type EndpointNode} from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { ReplayableRequest, ResearchExperiment, ResearchHypothesis } from './types'
import { stableId } from './utils'

function getEndpoint(store: GraphStore, id: string): EndpointNode | undefined {
  return store.getNode(id) as EndpointNode | undefined
}

export function planExperiments(store: GraphStore, hypotheses: ResearchHypothesis[]): ResearchExperiment[] {
  const experiments: ResearchExperiment[] = []

  for (const hypothesis of hypotheses) {
    const primary = hypothesis.targetEndpoints.map(id => getEndpoint(store, id)).find(Boolean)
    const props = primary?.properties
    const baselineRequest: ReplayableRequest | undefined = props
      ? {
          method: props.method as ReplayableRequest['method'],
          url: props.url,
          headers: props.headers,
        }
      : undefined

    if (hypothesis.kind === 'idor') {
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'cross-actor-object-replay']),
        hypothesisId: hypothesis.id,
        title: 'Replay object request across actors',
        setup: ['Capture a valid object request as actor A', 'Authenticate as actor B with a different account/object'],
        baselineRequest,
        mutation: 'Replace the object identifier or replay actor A object request using actor B auth context.',
        expectedSecureBehavior: 'Response is 403, 404, or fully redacted for actor B.',
        insecureSignal: 'Actor B receives 200 with actor A object details or sensitive fields.',
        requiredActors: ['actor-a', 'actor-b'],
        tools: ['getCapturedHeaders', 'httpRequest', 'compareResearchResponses', 'recordFindingCandidate'],
        status: 'planned',
      })
    } else if (hypothesis.kind === 'mass_assignment') {
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'server-controlled-field-mutation']),
        hypothesisId: hypothesis.id,
        title: 'Inject server-controlled fields into update request',
        setup: ['Capture a normal update request from the UI', 'Identify hidden owner/role/status fields'],
        baselineRequest,
        mutation: 'Add or modify role, ownerId, userId, orgId, isAdmin, status, or permission fields in the request body.',
        expectedSecureBehavior: 'Server ignores, strips, or rejects server-controlled fields.',
        insecureSignal: 'Response or later GET shows changed role, owner, tenant, or privileged field.',
        requiredActors: ['normal-user'],
        tools: ['httpRequest', 'compareResearchResponses', 'recordFindingCandidate'],
        status: 'planned',
      })
    } else if (hypothesis.kind === 'workflow_bypass') {
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'step-skip-or-replay']),
        hypothesisId: hypothesis.id,
        title: 'Skip workflow step or replay state-changing request',
        setup: ['Complete the workflow once through the UI', 'Capture the state-changing request'],
        baselineRequest,
        mutation: 'Replay the final request before prerequisites, after logout, after completion, or with altered state fields.',
        expectedSecureBehavior: 'Server enforces workflow state and rejects skipped/replayed steps.',
        insecureSignal: 'State changes without required prior steps or accepts repeated finalization.',
        requiredActors: ['normal-user'],
        tools: ['observeHumanActions', 'getCapturedHeaders', 'httpRequest', 'compareResearchResponses', 'recordFindingCandidate'],
        status: 'planned',
      })
    } else {
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'differential-check']),
        hypothesisId: hypothesis.id,
        title: 'Compare access across auth states and roles',
        setup: ['Capture a baseline authenticated response', 'Repeat as logged-out or lower-privilege actor'],
        baselineRequest,
        mutation: 'Replay the same request with missing auth, lower-privilege auth, or a different actor.',
        expectedSecureBehavior: 'Unauthorized actors receive denial or redacted data.',
        insecureSignal: 'Unauthorized or lower-privilege actor receives sensitive fields or equivalent content.',
        requiredActors: ['baseline-actor', 'comparison-actor'],
        tools: ['httpRequest', 'compareResearchResponses', 'recordFindingCandidate'],
        status: 'planned',
      })
    }
  }

  return experiments
}
