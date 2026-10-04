import {type EndpointNode} from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { ReplayableRequest, ResearchExperiment, ResearchHypothesis } from './types'
import { stableId } from './utils'

function getEndpoint(store: GraphStore, id: string): EndpointNode | undefined {
  return store.getNode(id) as EndpointNode | undefined
}

/** Prefer requests that can exercise application logic over static assets. */
function isDynamicEndpoint(endpoint: EndpointNode): boolean {
  const props = endpoint.properties
  const method = String(props.method ?? 'GET').toUpperCase()
  const contentType = String(props.contentType ?? '').toLowerCase()
  const params = Array.isArray(props.params) ? props.params.length : 0
  const hasSchema = Boolean((props as any).bodySchema)
  // Plain-text POSTs without parameters/schema are commonly transport
  // handshakes (websocket/socket polling), not application workflows.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return !(contentType.includes('text/plain') && params === 0 && !hasSchema)
  if (contentType && !contentType.includes('json') && !contentType.includes('form') && !contentType.includes('text')) return false
  try {
    const path = new URL(props.url).pathname.toLowerCase()
    return !/\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|webp|pdf|zip)$/.test(path)
  } catch {
    return true
  }
}

function endpointPriority(endpoint: EndpointNode): number {
  const props = endpoint.properties
  const method = String(props.method ?? 'GET').toUpperCase()
  let pathDepth = 0
  try { pathDepth = new URL(props.url).pathname.split('/').filter(Boolean).length } catch { /* keep zero */ }
  const params = Array.isArray(props.params) ? props.params.length : 0
  const responseSize = Number((props as any).responseSize ?? 0)
  return (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? 100 : 0) + params * 10 + pathDepth + Math.min(responseSize / 1000, 10)
}

export function planExperiments(store: GraphStore, hypotheses: ResearchHypothesis[]): ResearchExperiment[] {
  const experiments: ResearchExperiment[] = []

  for (const hypothesis of hypotheses) {
    const candidates = hypothesis.targetEndpoints.map(id => getEndpoint(store, id)).filter((endpoint): endpoint is EndpointNode => Boolean(endpoint))
    const primary = candidates.filter(isDynamicEndpoint).sort((a, b) => endpointPriority(b) - endpointPriority(a))[0] ?? candidates[0]
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
    } else if (hypothesis.kind === 'action_limit' && hypothesis.businessRule) {
      const rule = hypothesis.businessRule
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'bounded-action-limit-replay']),
        hypothesisId: hypothesis.id,
        title: `Verify the observed ${rule.allowedCount}-action limit`,
        setup: [
          `Confirm rule text “${rule.ruleText}” from captured response ${rule.ruleCaptureId}`,
          `Use captured state-changing request ${rule.actionRequestId} and the same actor throughout`,
          'Capture and record a fresh JSON state baseline before replay',
        ],
        baselineRequest: { method: rule.actionMethod as ReplayableRequest['method'], url: rule.actionUrl },
        mutation: `Run businessLogicAbuse with capturedRequestId=${rule.actionRequestId}, allowedCount=${rule.allowedCount}, and iterations=${rule.allowedCount + 1}; supply the same-actor baseline URL, numeric state key/value, and exact observed rule text.`,
        expectedSecureBehavior: 'The action after the explicitly observed limit is rejected or leaves the measured business state unchanged.',
        insecureSignal: 'The action after the limit changes the measured business state; confirm only after fresh independent retest.',
        requiredActors: ['same authenticated actor for rule, baseline, action, and state check'],
        tools: ['listCapturedRequests', 'recordEvidence', 'runPrimitive', 'writeFinding'],
        status: 'planned',
      })
    } else if (hypothesis.kind === 'reflected_injection') {
      const echoed = Array.isArray(hypothesis.targetParams) && hypothesis.targetParams.length > 0
        ? hypothesis.targetParams.join(', ')
        : 'observed query parameters'
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'marker-reflection-probe']),
        hypothesisId: hypothesis.id,
        title: 'Send a unique marker and check whether it is echoed back',
        setup: ['Capture a baseline request carrying a benign value', 'Replay with a unique marker in the echoed parameters'],
        baselineRequest,
        mutation: `Replace ${echoed} with a unique marker value and replay. The marker must not appear in the baseline response.`,
        expectedSecureBehavior: 'Server encodes, strips, or rejects the marker; it never appears verbatim in the response.',
        insecureSignal: 'The unique marker is echoed verbatim into the response body.',
        requiredActors: ['anonymous'],
        tools: ['httpRequest', 'replayCapturedRequest', 'compareResearchResponses', 'recordFindingCandidate'],
        status: 'planned',
      })
    } else if (hypothesis.kind === 'sql_injection') {
      const inputs = Array.isArray(hypothesis.targetParams) && hypothesis.targetParams.length > 0
        ? hypothesis.targetParams.join(', ')
        : 'observed string query inputs'
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'boolean-query-differential']),
        hypothesisId: hypothesis.id,
        title: 'Compare observed search input with a bounded boolean SQL expression',
        setup: ['Capture a non-empty benign value through the target UI', 'Use the same captured route and actor for all requests'],
        baselineRequest,
        mutation: `Change only observed query input ${inputs} to a bounded boolean expression; compare successful structured result counts.`,
        expectedSecureBehavior: 'The input is treated as data: the result shape and count do not expand because SQL boolean syntax was supplied.',
        insecureSignal: 'A boolean expression changes the query result set beyond the observed benign baseline and the effect holds on a fresh independent retest.',
        requiredActors: ['anonymous'],
        tools: ['executePlannedExperiment', 'evaluateResearchExperiment', 'writeFinding'],
        status: 'planned',
      })
    } else if (hypothesis.kind === 'open_redirect') {
      const destinations = Array.isArray(hypothesis.targetParams) && hypothesis.targetParams.length > 0
        ? hypothesis.targetParams.join(', ')
        : 'observed query parameters'
      experiments.push({
        id: stableId('experiment', [hypothesis.id, 'marker-redirect-probe']),
        hypothesisId: hypothesis.id,
        title: 'Swap the redirect destination for a unique marker URL and inspect Location',
        setup: ['Capture a baseline redirect request carrying a benign destination', 'Replay with a unique marker URL in the echoed parameters'],
        baselineRequest,
        mutation: `Replace ${destinations} with a unique marker URL and replay without following redirects. The marker host must never appear in the baseline Location.`,
        expectedSecureBehavior: 'Server validates the destination against an allowlist or rejects it; the marker URL never appears in Location.',
        insecureSignal: 'The 3xx Location header echoes the marker URL verbatim.',
        requiredActors: ['anonymous'],
        tools: ['httpRequest', 'replayCapturedRequest', 'compareResearchResponses', 'recordFindingCandidate'],
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
