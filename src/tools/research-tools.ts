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
import { getForensicLog } from './report-tools'

const responseLikeSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  url: z.string().optional(),
})

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
      persistExperiments(store, experiments)
      await store.save()

      return { ok: true, value: { experimentsPlanned: experiments.length, experiments } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const compareResearchResponses = createTool({
  id: 'compareResearchResponses',
  description: 'Compare baseline and mutated HTTP responses for authorization, sensitive-field, and state-change signals.',
  inputSchema: z.object({
    baseline: responseLikeSchema,
    mutated: responseLikeSchema,
  }),
  execute: async ({ baseline, mutated }) => {
    try {
      const differential = compareResponsesCore(baseline, mutated)
      return { ok: true, value: differential }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
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
