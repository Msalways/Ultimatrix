import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, type ExperimentNode } from '../graph/schema'
import { extractWorkflows } from '../research/workflow-extractor'
import { extractEntities } from '../research/entity-extractor'
import { findLocationEchoes, findReflectedParams, generateHypotheses, selectHypotheses } from '../research/hypothesis-engine'
import { planExperiments } from '../research/experiment-planner'
import { redirectMarkerUrl, reflectionMarker, reflectionMutation, redirectMutation } from '../research/utils'
import { compareResearchResponses as compareResponsesCore, compareStatefulReplayResponses } from '../research/differential'
import { candidateFromExperiment, listCandidates, upsertCandidate } from '../research/candidate-store'
import { assessCandidateForReport } from '../research/verifier'
import { getResearchSnapshot, persistEntities, persistExperiments, persistHypotheses, persistWorkflows } from '../research/graph-adapter'
import type { FindingCandidate, ResearchExperiment } from '../research/types'
import { evaluateExperimentOracle, evaluateIndependentRetest } from '../research/experiment-oracle'
import { coreEvidenceLedger } from '../core/evidence'
import { getForensicLog } from './report-tools'
import { getCapturedRequestStore, type CapturedRequest } from '../capture/captured-request-store'
import { replayCapturedRequest } from './replay-tools'
import { requestAsActor } from './actor-tools'
import { getGlobalSessionManager } from '../http/session-manager'
import { httpRequest } from './http-tools'
import { getInteractionMode } from './interaction-tools'

const responseLikeSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  url: z.string().optional(),
})

const evidenceIdSchema = z.string().min(1).describe('Canonical ID returned by a capture or request tool; graph Fact and Endpoint IDs are not evidence IDs.')

const evidenceOracleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unique-marker'), baselineEvidenceId: evidenceIdSchema, mutationEvidenceId: evidenceIdSchema, marker: z.string().min(1) }),
  z.object({ type: z.literal('json-array-growth'), baselineEvidenceId: evidenceIdSchema, mutationEvidenceId: evidenceIdSchema, minimumGrowth: z.number().int().positive() }),
  z.object({
    type: z.literal('database-error-differential'),
    baselineEvidenceId: evidenceIdSchema,
    mutationEvidenceId: evidenceIdSchema,
    inputLocation: z.enum(['query', 'json', 'form']),
    parameter: z.string().trim().min(1),
  }),
  z.object({ type: z.literal('cross-identity'), victimEvidenceId: evidenceIdSchema, attackerEvidenceId: evidenceIdSchema, victimActorRef: z.string(), attackerActorRef: z.string(), marker: z.string().min(1) }),
  z.object({ type: z.literal('state-transition'), beforeEvidenceId: evidenceIdSchema, afterEvidenceId: evidenceIdSchema, stateKey: z.string().describe('Observed state key, JSON dotted path, or body:<exact unique text>'), beforeValue: z.string(), afterValue: z.string() }),
  z.object({ type: z.literal('oast-callback'), evidenceId: evidenceIdSchema, correlationToken: z.string().min(1) }),
  z.object({ type: z.literal('timing-differential'), baselineEvidenceIds: z.array(evidenceIdSchema).min(1), mutationEvidenceIds: z.array(evidenceIdSchema).min(1), minSamples: z.number().int().positive(), minDeltaMs: z.number().nonnegative() }),
  z.object({ type: z.literal('browser-effect'), evidenceId: evidenceIdSchema, effectKey: z.string(), expectedValue: z.string() }),
])

async function executeTool(tool: any, args: Record<string, unknown>, context: { abortSignal?: AbortSignal } = {}): Promise<any> {
  if (!tool || typeof tool.execute !== 'function') return { ok: false, error: 'required research tool unavailable' }
  return tool.execute(args, context as never)
}

export const buildResearchMap = createTool({
  id: 'buildResearchMap',
  description: 'Extract workflows, entities, and explicit action-limit rules from observed target traffic; generate grounded hypotheses and persist the research map. Use before choosing what to test.',
  inputSchema: z.object({
    maxHypotheses: z.number().int().positive().optional().default(25),
  }),
  execute: async ({ maxHypotheses }) => {
    try {
      const store = getGlobalGraphStore()
      const workflows = extractWorkflows(store)
      const entities = extractEntities(store)
      // Reflection evidence comes from captured traffic (request values
      // echoed in response bodies), not the graph. Feed a bounded snapshot
      // so injection hypotheses generate from observed behavior.
      let captured: CapturedRequest[] = []
      try {
        const capturedStore = getCapturedRequestStore()
        captured = capturedStore.list({ limit: 300 })
          .map(ref => capturedStore.get(ref.id))
          .filter((entry): entry is CapturedRequest => Boolean(entry))
      } catch { /* capture unavailable — hypotheses fall back to graph structure */ }
      // The cap bounds context, but a flat top-N slice starves whole
      // attack classes when one speculative kind floods the ranking. Select
      // across kinds so capture-backed hypotheses survive the cut.
      const hypotheses = selectHypotheses(
        generateHypotheses(store, workflows, entities, captured),
        maxHypotheses || 25,
      )

      // Browser/HAR captures are target observations too. Import only the
      // exact response captures backing explicit usage-limit hypotheses so
      // businessLogicAbuse can verify them through the shared evidence gate.
      for (const hypothesis of hypotheses) {
        const businessRule = hypothesis.businessRule
        if (!businessRule || coreEvidenceLedger.all().some(item => item.observed?.captureId === businessRule.ruleCaptureId)) continue
        const response = captured.find(entry => entry.id === businessRule.ruleCaptureId)
        if (!response?.responseBody) continue
        coreEvidenceLedger.record({
          type: 'raw_response',
          label: `Captured business rule ${response.method} ${response.url}`,
          data: response.responseBody,
          observed: {
            method: response.method,
            url: response.url,
            status: response.status,
            responseHeaders: response.responseHeaders,
            responseBody: response.responseBody,
            captureId: response.id,
          },
        })
      }

      persistWorkflows(store, workflows)
      persistEntities(store, entities)
      persistHypotheses(store, hypotheses)
      await store.save()

      // Echo observability: the capture-driven rules depend on capture
      // evidence that may not exist yet (map built before probing). Report
      // the input counts so a missing hypothesis is diagnosable as "no echo
      // evidence" vs "rule failure".
      let reflectionSignals = 0
      let locationSignals = 0
      try {
        reflectionSignals = findReflectedParams(captured).length
      } catch { /* observability only — never fail the map */ }
      try {
        locationSignals = findLocationEchoes(captured).length
      } catch { /* observability only — never fail the map */ }
      const value = {
        workflows: workflows.length,
        entities: entities.length,
        hypotheses: hypotheses.length,
        topHypotheses: hypotheses.slice(0, 8),
        reflection: {
          capturesScanned: captured.length,
          echoesFound: reflectionSignals,
          injectionHypotheses: hypotheses.filter(h => h.kind === 'reflected_injection').length,
          locationEchoesFound: locationSignals,
          redirectHypotheses: hypotheses.filter(h => h.kind === 'open_redirect').length,
        },
      }
      getForensicLog()?.log({ type: 'tool-result', agent: 'solver-brain', tool: 'buildResearchMap', result: value })
      return { ok: true, value }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const planResearchExperiments = createTool({
  id: 'planResearchExperiments',
  description: 'Turn open research hypotheses into stateful experiments with baseline, mutation, expected secure behavior, and insecure signals.',
  inputSchema: z.object({
    hypothesisIds: z.array(z.string()).optional().describe('Optional explicit hypothesis IDs. Defaults to highest-confidence open hypotheses.'),
    maxExperiments: z.number().int().positive().optional().default(10),
  }),
  execute: async ({ hypothesisIds, maxExperiments }) => {
    try {
      const store = getGlobalGraphStore()
      const snapshot = getResearchSnapshot(store)
      let hypotheses = snapshot.hypotheses.filter(h => ['open', 'planned'].includes(h.status))
      if (hypothesisIds?.length) {
        const wanted = new Set(hypothesisIds)
        hypotheses = hypotheses.filter(h => wanted.has(h.id))
      }
      hypotheses = hypotheses.slice(0, maxExperiments || 10)
      const experiments = planExperiments(store, hypotheses).slice(0, maxExperiments || 10)
      // Planning is idempotent. Never reset a previously executed experiment
      // (rejected, interesting, or blocked) back to `planned` on the next
      // model turn; that was the source of apparent memory loss between turns.
      const existing = new Map(getResearchSnapshot(store).experiments.map(experiment => [experiment.id, experiment]))
      const newExperiments = experiments.filter(experiment => !existing.has(experiment.id))
      persistExperiments(store, newExperiments)
      await store.save()

      const retained = experiments.filter(experiment => existing.has(experiment.id)).map(experiment => existing.get(experiment.id)!)
      return { ok: true, value: { experimentsPlanned: newExperiments.length, experiments: [...newExperiments, ...retained] } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

const replayMutationSchema = z.object({
  setHeaders: z.record(z.string(), z.string()).optional(),
  removeHeaderNames: z.array(z.string()).optional(),
  body: z.string().optional(),
  appendBody: z.string().optional(),
  url: z.string().url().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
}).refine(v => !(v.body !== undefined && v.appendBody !== undefined), {
  message: 'Use either body or appendBody, not both',
})

type ReplayMutation = z.infer<typeof replayMutationSchema>

/** Pick a concrete mutation from the typed hypothesis when autonomy omitted one. */
export function automaticMutation(
  kind: string | undefined,
  request: { url: string; body?: string },
  targetParams?: string[],
): ReplayMutation | undefined {
  if (kind === 'idor' || kind === 'broken_access_control') {
    try {
      const url = new URL(request.url)
      const replace = (value: string): string | undefined => {
        if (/^\d+$/.test(value)) return String(Number(value) + 1)
        if (/^[0-9a-f]{8,}(-[0-9a-f-]{4,})?$/i.test(value)) return '00000000-0000-0000-0000-000000000001'
        return undefined
      }
      const segments = url.pathname.split('/')
      const index = segments.findIndex(segment => replace(segment) !== undefined)
      if (index >= 0) {
        segments[index] = replace(segments[index])!
        url.pathname = segments.join('/')
        return { url: url.toString() }
      }
      for (const [key, value] of url.searchParams.entries()) {
        const replacement = replace(value)
        if (replacement !== undefined) {
          url.searchParams.set(key, replacement)
          return { url: url.toString() }
        }
      }
    } catch { /* fall through to the auth-boundary differential */ }
  }
  if (kind === 'sql_injection') {
    try {
      const url = new URL(request.url)
      const names = (targetParams ?? []).filter(name => url.searchParams.has(name))
      if (names.length === 0) return undefined
      const selected = names[0]
      // One small, bounded tautology mutation: no stacked statements, writes,
      // sleep primitive, or out-of-band callback.
      url.searchParams.set(selected, "' OR 1=1 OR 'x'='x")
      return { url: url.toString() }
    } catch { return undefined }
  }

  if (kind === 'mass_assignment' && request.body) {
    try {
      const parsed = JSON.parse(request.body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { body: JSON.stringify({ ...parsed, __sentinel_probe: true }) }
      }
    } catch { /* non-JSON bodies use the auth-boundary fallback */ }
  }

  if (kind === 'reflected_injection') {
    // Marker-in-echoed-param: replace the observed reflection sink with a
    // deterministic unique marker. The caller asserts the marker in the
    // differential; the unique-marker oracle proves it on evaluation.
    const params = Array.isArray(targetParams) && targetParams.length > 0
      ? targetParams
      : (() => {
          try {
            return [...new URL(request.url).searchParams.keys()]
          } catch {
            return []
          }
        })()
    const { url } = reflectionMutation(request.url, params)
    if (url) return { url }
  }

  if (kind === 'open_redirect') {
    // Marker-URL-in-destination-param: swap the observed redirect sink for
    // a deterministic marker URL on a reserved host. The replay path never
    // follows redirects, so the marker host is never contacted; the
    // differential asserts it in the Location header.
    const params = Array.isArray(targetParams) && targetParams.length > 0
      ? targetParams
      : (() => {
          try {
            return [...new URL(request.url).searchParams.keys()]
          } catch {
            return []
          }
        })()
    const { url } = redirectMutation(request.url, params)
    if (url) return { url }
  }

  if (kind === 'workflow_bypass' || kind === 'replay') return {}
  if (kind === 'information_disclosure') {
    return { removeHeaderNames: ['authorization', 'cookie', 'x-auth-token', 'x-csrf-token'] }
  }
  // Object authorization is tested through the two actor sessions above;
  // keeping the captured request unchanged preserves that identity contrast.
  if (kind === 'idor' || kind === 'broken_access_control') return {}
  return undefined
}

/**
 * Execute one planned experiment end-to-end.  Planning is deliberately kept
 * separate from execution, but the solver must have a typed seam that turns a
 * graph experiment into real, captured traffic. Workflow replay keeps the
 * request identical and evaluates duplicate acceptance; unsupported mutation
 * classes block until the brain supplies an observed structural mutation.
 */
export const executePlannedExperiment = createTool({
  id: 'executePlannedExperiment',
  description: 'Execute a planned experiment against a matching captured request, replay baseline and mutation, compare typed responses, persist the differential, and create a candidate when the signal is interesting.',
  inputSchema: z.object({
    experimentId: z.string(),
    entryId: z.string().optional().describe('Captured request id; if omitted, match the experiment baseline method and URL.'),
    phase: z.enum(['initial', 'retest']).optional().default('initial').describe('Use retest only after the initial typed oracle is proven; both legs replay as fresh traffic.'),
    mutation: replayMutationSchema.optional().describe('Structural mutation selected by the active skill. Omit for a generic auth-boundary differential.'),
    assertion: z.object({ markers: z.array(z.string()).optional(), jsonFields: z.array(z.string()).optional() }).optional(),
  }),
  execute: async ({ experimentId, entryId, phase, mutation, assertion }, context) => {
    const executionPhase = phase ?? 'initial'
    const toolContext = { abortSignal: context?.abortSignal }
    const store = getGlobalGraphStore()
    const node = store.getNode(experimentId) as ExperimentNode | undefined
    if (!node || node.type !== NodeType.EXPERIMENT) return { ok: false, error: `Experiment not found: ${experimentId}` }
    if (executionPhase === 'initial' && !['planned', 'blocked', 'rejected'].includes(node.properties.status)) {
      return { ok: false, error: `Experiment ${experimentId} is not executable in status ${node.properties.status}` }
    }
    if (executionPhase === 'retest' && node.properties.outcome?.status !== 'proven') {
      return { ok: false, error: `Experiment ${experimentId} needs a proven initial oracle before a fresh retest` }
    }
    const plannedMethod = String(node.properties.baselineRequest?.method ?? 'GET').toUpperCase()
    const mutationMethod = String(mutation?.method ?? plannedMethod).toUpperCase()
    const safeMethods = ['GET', 'HEAD', 'OPTIONS']
    if (getInteractionMode() !== 'run' && (!safeMethods.includes(plannedMethod) || !safeMethods.includes(mutationMethod))) {
      return {
        ok: false,
        code: 'APPROVAL_REQUIRED',
        error: 'Active experiment execution requires explicit run-mode approval.',
        experimentId,
        requiredApproval: 'interactionMode=run',
      }
    }

    // Every experiment leg is dispatched through replayCapturedRequest or
    // httpRequest, whose shared HTTP boundary asks before state-changing work.
    const hypothesis = node.properties.hypothesisId
      ? store.getNode(node.properties.hypothesisId) as { properties?: { kind?: string; targetParams?: string[] } } | undefined
      : undefined
    const hypothesisKind = hypothesis?.properties?.kind
    const hypothesisParams = Array.isArray(hypothesis?.properties?.targetParams)
      ? hypothesis.properties.targetParams.filter((p): p is string => typeof p === 'string')
      : undefined
    if (hypothesisKind === 'race_condition') {
      const reason = 'blocked: executePlannedExperiment dispatches requests sequentially; a race hypothesis requires a concurrent request runner.'
      node.properties.status = 'blocked'
      node.properties.resultSummary = reason
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, code: 'CONCURRENCY_REQUIRED', error: reason, experimentId }
    }
    const actorSessions = getGlobalSessionManager().listSessions()
    // Cross-user hypotheses (IDOR / object-level access control) are only
    // meaningful with two authenticated actors. Gate BEFORE capture work:
    // with fewer actors the generic auth-stripping fallback would silently
    // downgrade the test into an anonymous differential that can neither
    // prove nor disprove cross-user access. Fail closed with the exact
    // missing setup instead — the experiment stays re-runnable once actors
    // exist (blocked is executable).
    if ((hypothesisKind === 'idor' || hypothesisKind === 'broken_access_control') && actorSessions.length < 2) {
      const reason = `blocked: hypothesis requires two authenticated actors, found ${actorSessions.length}. Acquire a second actor (credential login via browser, then verify both sessions) and re-run.`
      node.properties.status = 'blocked'
      node.properties.resultSummary = reason
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, code: 'ACTORS_REQUIRED', error: reason, experimentId, requiredActors: ['actor-a', 'actor-b'], actorsPresent: actorSessions.length }
    }

    const capturedStore = getCapturedRequestStore()
    const baseline = node.properties.baselineRequest as { method?: string; url?: string; headers?: Record<string, string>; body?: string } | undefined
    let selected = entryId ? capturedStore.get(entryId) : null
    if (!selected && baseline?.url) {
      const wantedMethod = (baseline.method ?? '').toUpperCase()
      let baselineUrl: URL | undefined
      try { baselineUrl = new URL(baseline.url) } catch { /* captured matcher below will simply miss invalid URLs */ }
      const matching = capturedStore.list({ limit: 200 }).map(ref => capturedStore.get(ref.id)).filter((entry): entry is CapturedRequest => {
        if (!entry || (wantedMethod && entry.method.toUpperCase() !== wantedMethod)) return false
        if (entry.url === baseline.url) return true
        if (!baselineUrl) return false
        try {
          const candidateUrl = new URL(entry.url)
          return candidateUrl.origin === baselineUrl.origin && candidateUrl.pathname === baselineUrl.pathname
        } catch { return false }
      })
      if (hypothesisKind === 'sql_injection' && hypothesisParams?.length) {
        // The baseline must be an actual non-empty benign input sent through
        // the UI. An empty default search cannot establish a useful contrast.
        selected = matching.filter(entry => entry.source !== 'tool').reverse().find(entry => {
          try {
            const query = new URL(entry.url).searchParams
            return hypothesisParams.some(name => (query.get(name) ?? '').trim().length > 0)
          } catch { return false }
        }) ?? null
        if (!selected) {
          node.properties.status = 'blocked'
          node.properties.resultSummary = `blocked: SQL injection experiment requires a non-empty benign value in observed query input(s) ${hypothesisParams.join(', ')} from a captured UI request.`
          node.updatedAt = Date.now()
          await store.save()
          return { ok: false, code: 'BASELINE_INPUT_REQUIRED', error: node.properties.resultSummary, requiredEvidence: 'browser-captured non-empty input on the observed route' }
        }
      } else if (['workflow_bypass', 'replay'].includes(String(hypothesisKind))) {
        // A route can contain multiple workflow actions (for example, issue
        // a recovery ticket, then consume it). Replay the latest observed
        // state-changing action so the test targets the workflow's terminal
        // transition instead of repeating setup.
        const stateChanging = matching.filter(entry => !safeMethods.includes(entry.method.toUpperCase()))
        selected = stateChanging.filter(entry => entry.source !== 'tool').at(-1)
          ?? stateChanging.at(-1)
          ?? matching.at(-1)
          ?? null
      } else {
        selected = matching.filter(entry => entry.url === baseline.url).at(-1)
          ?? matching.at(-1)
          ?? null
      }
    }
    // A graph baseline can legitimately predate capture (for example a
    // discovered static asset). Acquire it through the normal scoped HTTP
    // path instead of abandoning the experiment; httpRequest records the new
    // request in the captured store and evidence ledger.
    if (!selected && baseline?.url && baseline.method) {
      const acquired = await executeTool(httpRequest, {
        method: baseline.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        url: baseline.url,
        ...(baseline.headers ? { headers: baseline.headers } : {}),
        ...(baseline.body !== undefined ? { body: baseline.body } : {}),
        timeoutMs: 10_000,
      }, toolContext)
      if (acquired?.ok) {
        selected = capturedStore.list({ limit: 200 }).map(ref => capturedStore.get(ref.id)).reverse().find(entry =>
          !!entry && entry.url === baseline.url && entry.method.toUpperCase() === String(baseline.method).toUpperCase(),
        ) ?? null
      }
    }
    if (!selected) {
      node.properties.status = 'blocked'
      node.properties.resultSummary = 'blocked: no captured request matches the experiment baseline and baseline acquisition failed.'
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, code: 'BASELINE_UNAVAILABLE', error: node.properties.resultSummary, experimentId }
    }
    if (hypothesisKind === 'sql_injection' && hypothesisParams?.length) {
      const hasObservedBenignValue = selected.source !== 'tool' && hypothesisParams.some(name => {
        try { return (new URL(selected!.url).searchParams.get(name) ?? '').trim().length > 0 } catch { return false }
      })
      if (!hasObservedBenignValue) {
        node.properties.status = 'blocked'
        node.properties.resultSummary = `blocked: SQL injection experiment requires a non-empty benign value in observed query input(s) ${hypothesisParams.join(', ')} from a captured UI request.`
        node.updatedAt = Date.now()
        await store.save()
        return { ok: false, code: 'BASELINE_INPUT_REQUIRED', error: node.properties.resultSummary, requiredEvidence: 'browser-captured non-empty input on the observed route' }
      }
    }

    const alternateActor = actorSessions.length > 1 &&
      ['idor', 'broken_access_control', 'information_disclosure'].includes(String(hypothesisKind))
      ? actorSessions[1]
      : undefined
    const appliedMutation = mutation ?? automaticMutation(hypothesisKind, selected, hypothesisParams)
    const statefulReplay = Boolean(appliedMutation && ['workflow_bypass', 'replay'].includes(String(hypothesisKind)) && Object.keys(appliedMutation).length === 0)
    if (!appliedMutation || (Object.keys(appliedMutation).length === 0 && !statefulReplay && !alternateActor)) {
      const reason = !appliedMutation
        ? `blocked: no grounded mutation is available for ${String(hypothesisKind ?? 'this hypothesis')}; select a structural change from observed target traffic.`
        : `blocked: an empty mutation does not test ${String(hypothesisKind ?? 'this hypothesis')}; select a structural change from observed target traffic.`
      node.properties.status = 'blocked'
      node.properties.resultSummary = reason
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, code: 'STRUCTURAL_MUTATION_REQUIRED', error: reason, experimentId }
    }
    if (statefulReplay && safeMethods.includes(selected.method.toUpperCase())) {
      const reason = `blocked: a workflow replay needs an observed state-changing request; captured ${selected.method.toUpperCase()} ${selected.url}.`
      node.properties.status = 'blocked'
      node.properties.resultSummary = reason
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, code: 'STATE_CHANGING_REQUEST_REQUIRED', error: reason, experimentId }
    }

    node.properties.status = 'running'
    node.properties.baselineRequest = { method: selected.method, url: selected.url, headers: selected.headers, ...(selected.body !== undefined ? { body: selected.body } : {}) }
    node.updatedAt = Date.now()
    await store.save()

    const evidenceBeforeBaseline = new Set(coreEvidenceLedger.all().map(item => item.id))
    // Victim view: for cross-user hypotheses with two actors, the baseline
    // itself replays under the first actor so BOTH sides carry session-tagged
    // evidence the cross-identity oracle can verify. A raw capture replay
    // would leave the victim side anonymous and unprovable. Other kinds keep
    // the byte-identical baseline replay.
    const victimActor = alternateActor &&
      (hypothesisKind === 'idor' || hypothesisKind === 'broken_access_control')
      ? actorSessions[0]
      : undefined
    const baseResult = victimActor
      ? await executeTool(requestAsActor, { capturedRequestId: selected.id, actorId: victimActor, timeoutMs: appliedMutation.timeoutMs ?? 10_000 }, toolContext)
      : await executeTool(replayCapturedRequest, { entryId: selected.id, timeoutMs: appliedMutation.timeoutMs ?? 10_000 }, toolContext)
    if (!baseResult?.ok) {
      node.properties.status = 'blocked'
      node.properties.resultSummary = `baseline replay failed: ${baseResult?.error ?? 'unknown error'}`
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, error: node.properties.resultSummary }
    }
    const baselineEvidence = coreEvidenceLedger.all().filter(item => !evidenceBeforeBaseline.has(item.id))
    const evidenceBeforeMutation = new Set(coreEvidenceLedger.all().map(item => item.id))
    const mutatedResult = alternateActor
      ? await executeTool(requestAsActor, {
          capturedRequestId: selected.id,
          actorId: alternateActor,
          ...(appliedMutation.url ? { url: appliedMutation.url } : {}),
          ...(appliedMutation.method ? { method: appliedMutation.method } : {}),
          ...(appliedMutation.body !== undefined ? { body: appliedMutation.body } : {}),
          timeoutMs: appliedMutation.timeoutMs ?? 10_000,
        }, toolContext)
      : await executeTool(replayCapturedRequest, { entryId: selected.id, ...appliedMutation, timeoutMs: appliedMutation.timeoutMs ?? 10_000 }, toolContext)
    if (!mutatedResult?.ok) {
      node.properties.status = 'blocked'
      node.properties.resultSummary = `mutation replay failed: ${mutatedResult?.error ?? 'unknown error'}`
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, error: node.properties.resultSummary }
    }
    const mutationEvidence = coreEvidenceLedger.all().filter(item => !evidenceBeforeMutation.has(item.id))

    const baselineResponse = { status: baseResult.value.replayedStatus ?? baseResult.value.actorStatus ?? selected.status ?? 0, headers: baseResult.value.response?.headers, body: baseResult.value.response?.body, url: selected.url }
    const mutatedResponse = {
      status: mutatedResult.value.replayedStatus ?? mutatedResult.value.actorStatus ?? 0,
      headers: mutatedResult.value.response?.headers,
      body: mutatedResult.value.response?.body,
      url: mutatedResult.value.requestSent?.url ?? selected.url,
    }
    // Marker auto-assertion: the challenge injected by automaticMutation
    // must be declared as an observable, otherwise the differential has no
    // typed signal to match and a real echo reads as "no strong
    // differential". Markers are derived from the parameters the mutation
    // actually rewrote — never guessed. The builder is chosen by hypothesis
    // kind (body marker vs redirect marker URL); both derive from the
    // ORIGINAL request URL, never the mutated one.
    let mergedAssertion = assertion
    if ((hypothesisKind === 'reflected_injection' || hypothesisKind === 'open_redirect') && typeof appliedMutation.url === 'string') {
      try {
        // Markers derive from the ORIGINAL request URL (same input the
        // mutation builder used), never the mutated URL — deriving from the
        // mutated URL would hash the marker itself and never match.
        const before = new URL(selected.url).searchParams
        const after = new URL(appliedMutation.url).searchParams
        const markerFor = (name: string): string => hypothesisKind === 'open_redirect'
          ? redirectMarkerUrl(selected.url, name)
          : reflectionMarker(selected.url, name)
        const autoMarkers = [...after.keys()].filter(name => {
          const marker = markerFor(name)
          return after.get(name) === marker && before.get(name) !== marker
        }).map(name => markerFor(name))
        if (autoMarkers.length > 0) {
          mergedAssertion = { markers: [...(assertion?.markers ?? []), ...autoMarkers], jsonFields: assertion?.jsonFields }
        }
      } catch { /* malformed URLs simply skip auto-assertion */ }
    }
    const differential = statefulReplay
      ? compareStatefulReplayResponses(baselineResponse, mutatedResponse)
      : compareResponsesCore(baselineResponse, mutatedResponse, mergedAssertion)
    node.properties.differential = differential as unknown as Record<string, unknown>
    node.properties.resultSummary = differential.reason
    node.properties.status = differential.interesting ? 'interesting' : 'rejected'
    node.updatedAt = Date.now()
    await store.save()

    let candidate: FindingCandidate | undefined
    if (differential.interesting && executionPhase === 'initial') {
      candidate = candidateFromExperiment({ id: node.id, ...node.properties } as ResearchExperiment, differential, [
        `baseline:${selected.id}:${baselineResponse.status}`,
        `mutation:${selected.id}:${mutatedResponse.status}`,
        `raw baseline response evidence: ${baselineEvidence.map(item => item.id).join(', ') || 'captured by httpRequest'}`,
        `raw mutation response evidence: ${mutationEvidence.map(item => item.id).join(', ') || 'captured by httpRequest'}`,
      ])
      upsertCandidate(store, candidate)
      await store.save()
    }
    const compactEvidence = (items: typeof baselineEvidence) => items.map(item => {
      let collectionSize: number | undefined
      try {
        const parsed: unknown = JSON.parse(item.observed?.responseBody ?? item.data)
        if (Array.isArray(parsed)) collectionSize = parsed.length
        else if (parsed && typeof parsed === 'object') {
          const record = parsed as Record<string, unknown>
          for (const key of ['data', 'products', 'results', 'items']) {
            if (Array.isArray(record[key])) { collectionSize = (record[key] as unknown[]).length; break }
          }
        }
      } catch { /* response remains available by evidence id */ }
      return { id: item.id, url: item.observed?.url, status: item.observed?.status, responseBytes: item.data.length, ...(collectionSize !== undefined ? { collectionSize } : {}) }
    })
    return { ok: true, value: {
      experimentId, phase: executionPhase, entryId: selected.id,
      ...(alternateActor ? { alternateActor } : {}),
      mutation: appliedMutation,
      baselineEvidence: compactEvidence(baselineEvidence),
      mutationEvidence: compactEvidence(mutationEvidence),
      differential,
      candidate: candidate ? { id: candidate.id, status: candidate.status } : undefined,
    } }
  },
})

export const compareResearchResponses = createTool({
  id: 'compareResearchResponses',
  description: 'Compare baseline and mutated HTTP responses for authorization, sensitive-field, and state-change signals.',
  inputSchema: z.object({
    baseline: responseLikeSchema,
    mutated: responseLikeSchema,
    assertion: z.object({
      markers: z.array(z.string()).optional(),
      jsonFields: z.array(z.string()).optional(),
    }).optional().describe('Target-specific observable values or JSON paths selected by the researcher.'),
  }),
  execute: async ({ baseline, mutated, assertion }) => {
    try {
      const differential = compareResponsesCore(baseline, mutated, assertion)
      return { ok: true, value: differential }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const evaluateResearchExperiment = createTool({
  id: 'evaluateResearchExperiment',
  description: 'Evaluate a typed experiment oracle against recorded evidence and persist a proven, disproven, or inconclusive outcome. Use the canonical evidenceId returned by each request/capture result; graph Fact IDs do not resolve to raw request/response evidence.',
  inputSchema: z.object({
    experimentId: z.string(),
    oracle: evidenceOracleSchema,
    phase: z.enum(['initial', 'retest']).optional().default('initial'),
  }),
  execute: async ({ experimentId, oracle, phase }) => {
    const store = getGlobalGraphStore()
    const experiment = store.getNode(experimentId) as ExperimentNode | undefined
    if (!experiment || experiment.type !== NodeType.EXPERIMENT) return { ok: false, error: `Experiment not found: ${experimentId}` }
    if (phase === 'retest') {
      const initial = experiment.properties.outcome
      if (!experiment.properties.oracle || initial?.status !== 'proven') {
        return { ok: false, error: `Experiment ${experimentId} must be proven before retest` }
      }
      const outcome = evaluateIndependentRetest(experimentId, experiment.properties.oracle, initial.proof, oracle, coreEvidenceLedger.all())
      experiment.properties.retest = { oracle, outcome, evaluatedAt: new Date().toISOString() }
      experiment.properties.status = outcome.status === 'proven' ? 'interesting' : 'blocked'
      experiment.properties.resultSummary = `retest:${outcome.status}`
      experiment.updatedAt = Date.now()
      await store.save()
      return { ok: true, value: { experimentId, phase, outcome } }
    }
    const outcome = evaluateExperimentOracle(experimentId, oracle, coreEvidenceLedger.all(), 'initial')
    experiment.properties.oracle = oracle
    experiment.properties.outcome = outcome
    experiment.properties.status = outcome.status === 'proven' ? 'interesting' : outcome.status === 'disproven' ? 'rejected' : 'blocked'
    experiment.properties.resultSummary = outcome.status
    experiment.updatedAt = Date.now()
    await store.save()
    return { ok: true, value: { experimentId, phase, outcome } }
  },
})

export const recordFindingCandidate = createTool({
  id: 'recordFindingCandidate',
  description: 'Persist a weak or strong bug-bounty signal as a candidate finding so the researcher can revisit and verify it.',
  inputSchema: z.object({
    experimentId: z.string().optional(),
    title: z.string().optional(),
    signalType: z.string().optional(),
    endpoint: z.string().optional(),
    evidence: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
    differential: z.object({
      sameStatus: z.boolean(),
      statusDelta: z.string(),
      bodySimilarity: z.number(),
      leakedFields: z.array(z.string()),
      authorizationMismatch: z.boolean(),
      interesting: z.boolean(),
      reason: z.string(),
    }).optional(),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      let candidate: FindingCandidate

      if (input.experimentId && input.differential) {
        const experimentNode = store.getNode(input.experimentId) as ExperimentNode | undefined
        if (!experimentNode || experimentNode.type !== NodeType.EXPERIMENT) {
          return { ok: false, error: `Experiment not found: ${input.experimentId}` }
        }
        candidate = candidateFromExperiment(
          { id: experimentNode.id, ...experimentNode.properties } as ResearchExperiment,
          input.differential,
          input.evidence || [],
        )
      } else {
        const endpoint = input.endpoint || 'unknown'
        candidate = {
          id: `candidate:manual:${Date.now()}`,
          title: input.title || 'Research candidate requires verification',
          signalType: input.signalType || 'manual-signal',
          endpoint,
          evidence: input.evidence || [],
          experimentIds: input.experimentId ? [input.experimentId] : [],
          confidence: input.confidence ?? 0.45,
          nextVerificationSteps: [
            'Capture raw request and response.',
            'Repeat with a clean session.',
            'Compare against expected secure behavior.',
          ],
          blockers: [],
          status: (input.confidence ?? 0.45) >= 0.7 ? 'candidate' : 'needs-more-evidence',
          severity: input.severity || 'medium',
        }
      }

      const node = upsertCandidate(store, candidate)
      await store.save()
      return { ok: true, value: { candidate: { id: node.id, ...node.properties } } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const assessCandidateReportability = createTool({
  id: 'assessCandidateReportability',
  description: 'Check whether a candidate finding has enough evidence to become a bounty-ready report.',
  inputSchema: z.object({
    candidateId: z.string(),
  }),
  execute: async ({ candidateId }) => {
    try {
      const store = getGlobalGraphStore()
      const candidate = listCandidates(store).find(c => c.id === candidateId)
      if (!candidate) return { ok: false, error: `Candidate not found: ${candidateId}` }
      return { ok: true, value: assessCandidateForReport(candidate) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getResearchStatus = createTool({
  id: 'getResearchStatus',
  description: 'Get the current bug-bounty research queue: workflows, entities, hypotheses, experiments, and candidate findings.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      const snapshot = getResearchSnapshot(store)
      return {
        ok: true,
        value: {
          counts: {
            workflows: snapshot.workflows.length,
            entities: snapshot.entities.length,
            hypotheses: snapshot.hypotheses.length,
            experiments: snapshot.experiments.length,
            candidates: snapshot.candidates.length,
          },
          nextHypotheses: snapshot.hypotheses.filter(h => h.status === 'open').slice(0, 8),
          nextExperiments: snapshot.experiments.filter(e => e.status === 'planned').slice(0, 8),
          candidates: snapshot.candidates.slice(0, 8),
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
