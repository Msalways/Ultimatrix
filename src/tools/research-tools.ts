import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, type ExperimentNode } from '../graph/schema'
import { extractWorkflows } from '../research/workflow-extractor'
import { extractEntities } from '../research/entity-extractor'
import { generateHypotheses } from '../research/hypothesis-engine'
import { planExperiments } from '../research/experiment-planner'
import { compareResearchResponses as compareResponsesCore } from '../research/differential'
import { candidateFromExperiment, listCandidates, upsertCandidate } from '../research/candidate-store'
import { assessCandidateForReport } from '../research/verifier'
import { getResearchSnapshot, persistEntities, persistExperiments, persistHypotheses, persistWorkflows } from '../research/graph-adapter'
import type { FindingCandidate, ResearchExperiment } from '../research/types'
import { evaluateExperimentOracle, evaluateIndependentRetest } from '../research/experiment-oracle'
import { coreEvidenceLedger } from '../core/evidence'
import { getForensicLog } from './report-tools'
import { getCapturedRequestStore } from '../capture/captured-request-store'
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

const evidenceOracleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unique-marker'), baselineEvidenceId: z.string(), mutationEvidenceId: z.string(), marker: z.string().min(1) }),
  z.object({ type: z.literal('cross-identity'), victimEvidenceId: z.string(), attackerEvidenceId: z.string(), victimActorRef: z.string(), attackerActorRef: z.string(), marker: z.string().min(1) }),
  z.object({ type: z.literal('state-transition'), beforeEvidenceId: z.string(), afterEvidenceId: z.string(), stateKey: z.string(), beforeValue: z.string(), afterValue: z.string() }),
  z.object({ type: z.literal('oast-callback'), evidenceId: z.string(), correlationToken: z.string().min(1) }),
  z.object({ type: z.literal('timing-differential'), baselineEvidenceIds: z.array(z.string()).min(1), mutationEvidenceIds: z.array(z.string()).min(1), minSamples: z.number().int().positive(), minDeltaMs: z.number().nonnegative() }),
  z.object({ type: z.literal('browser-effect'), evidenceId: z.string(), effectKey: z.string(), expectedValue: z.string() }),
])

export const buildResearchMap = createTool({
  id: 'buildResearchMap',
  description: 'Extract workflows and entities from the graph, generate bug-bounty hypotheses, and persist the research map. Use before choosing what to test.',
  inputSchema: z.object({
    maxHypotheses: z.number().int().positive().optional().default(25),
  }),
  execute: async ({ maxHypotheses }) => {
    try {
      const store = getGlobalGraphStore()
      const workflows = extractWorkflows(store)
      const entities = extractEntities(store)
      const hypotheses = generateHypotheses(store, workflows, entities).slice(0, maxHypotheses || 25)

      persistWorkflows(store, workflows)
      persistEntities(store, entities)
      persistHypotheses(store, hypotheses)
      await store.save()

      const value = {
        workflows: workflows.length,
        entities: entities.length,
        hypotheses: hypotheses.length,
        topHypotheses: hypotheses.slice(0, 8),
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
export function automaticMutation(kind: string | undefined, request: { url: string; body?: string }): ReplayMutation {
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

  if (kind === 'mass_assignment' && request.body) {
    try {
      const parsed = JSON.parse(request.body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { body: JSON.stringify({ ...parsed, __sentinel_probe: true }) }
      }
    } catch { /* non-JSON bodies use the auth-boundary fallback */ }
  }

  return { removeHeaderNames: ['authorization', 'cookie', 'x-auth-token', 'x-csrf-token'] }
}

/**
 * Execute one planned experiment end-to-end.  Planning is deliberately kept
 * separate from execution, but the solver must have a typed seam that turns a
 * graph experiment into real, captured traffic.  The default mutation is a
 * generic anonymous-session differential (remove common auth headers); callers
 * can provide a skill-selected structural mutation instead.
 */
export const executePlannedExperiment = createTool({
  id: 'executePlannedExperiment',
  description: 'Execute a planned experiment against a matching captured request, replay baseline and mutation, compare typed responses, persist the differential, and create a candidate when the signal is interesting.',
  inputSchema: z.object({
    experimentId: z.string(),
    entryId: z.string().optional().describe('Captured request id; if omitted, match the experiment baseline method and URL.'),
    mutation: replayMutationSchema.optional().describe('Structural mutation selected by the active skill. Omit for a generic auth-boundary differential.'),
    assertion: z.object({ markers: z.array(z.string()).optional(), jsonFields: z.array(z.string()).optional() }).optional(),
  }),
  execute: async ({ experimentId, entryId, mutation, assertion }) => {
    const store = getGlobalGraphStore()
    const node = store.getNode(experimentId) as ExperimentNode | undefined
    if (!node || node.type !== NodeType.EXPERIMENT) return { ok: false, error: `Experiment not found: ${experimentId}` }
    if (!['planned', 'blocked', 'rejected'].includes(node.properties.status)) {
      return { ok: false, error: `Experiment ${experimentId} is not executable in status ${node.properties.status}` }
    }

    // This tool is callable from several registries, so it enforces the
    // execution approval boundary internally instead of relying on a brain
    // wrapper. Safe idempotent baselines remain available in collaborative
    // mode; active experiments require an explicit run-mode decision.
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

    const capturedStore = getCapturedRequestStore()
    const baseline = node.properties.baselineRequest as { method?: string; url?: string } | undefined
    let selected = entryId ? capturedStore.get(entryId) : null
    if (!selected && baseline?.url) {
      const wantedMethod = (baseline.method ?? '').toUpperCase()
      let baselineUrl: URL | undefined
      try { baselineUrl = new URL(baseline.url) } catch { /* captured matcher below will simply miss invalid URLs */ }
      selected = capturedStore.list({ limit: 200 }).map(ref => capturedStore.get(ref.id)).find(entry => {
        if (!entry || (wantedMethod && entry.method.toUpperCase() !== wantedMethod)) return false
        if (entry.url === baseline.url) return true
        if (!baselineUrl) return false
        try {
          const candidateUrl = new URL(entry.url)
          return candidateUrl.origin === baselineUrl.origin && candidateUrl.pathname === baselineUrl.pathname
        } catch { return false }
      }) ?? null
    }
    // A graph baseline can legitimately predate capture (for example a
    // discovered static asset). Acquire it through the normal scoped HTTP
    // path instead of abandoning the experiment; httpRequest records the new
    // request in the captured store and evidence ledger.
    if (!selected && baseline?.url && baseline.method) {
      const acquired = await httpRequest.execute({
        method: baseline.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        url: baseline.url,
        ...(baseline.headers ? { headers: baseline.headers } : {}),
        ...(baseline.body !== undefined ? { body: baseline.body } : {}),
        timeoutMs: 10_000,
      }, {} as never) as any
      if (acquired?.ok) {
        selected = capturedStore.list({ limit: 200 }).map(ref => capturedStore.get(ref.id)).reverse().find(entry =>
          !!entry && entry.url === baseline.url && entry.method.toUpperCase() === String(baseline.method).toUpperCase(),
        ) ?? null
      }
    }
    if (!selected) return { ok: false, error: 'No captured request matches this experiment baseline and baseline acquisition failed.' }

    node.properties.status = 'running'
    node.updatedAt = Date.now()
    await store.save()

    const hypothesis = node.properties.hypothesisId
      ? store.getNode(node.properties.hypothesisId) as { properties?: { kind?: string } } | undefined
      : undefined
    const appliedMutation = mutation ?? automaticMutation(hypothesis?.properties?.kind, selected)
    const hypothesisKind = hypothesis?.properties?.kind
    const actorSessions = getGlobalSessionManager().listSessions()
    const alternateActor = actorSessions.length > 1 &&
      ['idor', 'broken_access_control', 'information_disclosure'].includes(String(hypothesisKind))
      ? actorSessions[1]
      : undefined
    const evidenceBeforeBaseline = new Set(coreEvidenceLedger.all().map(item => item.id))
    const baseResult = await replayCapturedRequest.execute({ entryId: selected.id, timeoutMs: appliedMutation.timeoutMs ?? 10_000 }, {} as never) as any
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
      ? await requestAsActor.execute({
          capturedRequestId: selected.id,
          actorId: alternateActor,
          ...(appliedMutation.url ? { url: appliedMutation.url } : {}),
          ...(appliedMutation.method ? { method: appliedMutation.method } : {}),
          ...(appliedMutation.body !== undefined ? { body: appliedMutation.body } : {}),
          timeoutMs: appliedMutation.timeoutMs ?? 10_000,
        }, {} as never) as any
      : await replayCapturedRequest.execute({ entryId: selected.id, ...appliedMutation, timeoutMs: appliedMutation.timeoutMs ?? 10_000 }, {} as never) as any
    if (!mutatedResult?.ok) {
      node.properties.status = 'blocked'
      node.properties.resultSummary = `mutation replay failed: ${mutatedResult?.error ?? 'unknown error'}`
      node.updatedAt = Date.now()
      await store.save()
      return { ok: false, error: node.properties.resultSummary }
    }
    const mutationEvidence = coreEvidenceLedger.all().filter(item => !evidenceBeforeMutation.has(item.id))

    const baselineResponse = { status: baseResult.value.replayedStatus ?? selected.status ?? 0, headers: baseResult.value.response?.headers, body: baseResult.value.response?.body, url: selected.url }
    const mutatedResponse = {
      status: mutatedResult.value.replayedStatus ?? mutatedResult.value.actorStatus ?? 0,
      headers: mutatedResult.value.response?.headers,
      body: mutatedResult.value.response?.body,
      url: mutatedResult.value.requestSent?.url ?? selected.url,
    }
    const differential = compareResponsesCore(baselineResponse, mutatedResponse, assertion)
    node.properties.differential = differential
    node.properties.resultSummary = differential.reason
    node.properties.status = differential.interesting ? 'interesting' : 'rejected'
    node.updatedAt = Date.now()
    await store.save()

    let candidate: FindingCandidate | undefined
    if (differential.interesting) {
      candidate = candidateFromExperiment({ id: node.id, ...node.properties } as ResearchExperiment, differential, [
        `baseline:${selected.id}:${baselineResponse.status}`,
        `mutation:${selected.id}:${mutatedResponse.status}`,
        `raw baseline response evidence: ${baselineEvidence.map(item => item.id).join(', ') || 'captured by httpRequest'}`,
        `raw mutation response evidence: ${mutationEvidence.map(item => item.id).join(', ') || 'captured by httpRequest'}`,
      ])
      upsertCandidate(store, candidate)
      await store.save()
    }
    return { ok: true, value: { experimentId, entryId: selected.id, ...(alternateActor ? { alternateActor } : {}), mutation: appliedMutation, baseline: baselineResponse, mutated: mutatedResponse, differential, candidate: candidate ? { id: candidate.id, status: candidate.status } : undefined } }
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
  description: 'Evaluate a model-designed typed experiment oracle against recorded evidence and persist a proven, disproven, or inconclusive outcome.',
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
