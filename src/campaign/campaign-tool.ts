/**
 * Campaign Dispatch Tool — Phase 2 / T2.6
 *
 * A Mastra tool the LLM strategist can call to plan + execute a coverage
 * campaign against the current knowledge graph. It:
 *   - builds an EvidenceGate (shared with writeFinding via setEvidenceGateForFindings)
 *   - builds a PrimitiveRunner that executes each primitive via the real HTTP tool
 *   - calls executeCampaign(graphStore, config, { executor, primitives, evidenceGate })
 *   - returns the CampaignResult (findings + coverage) to the LLM
 *
 * This lets the strategist emit whole campaigns instead of single tool calls,
 * while confirmed primitives are still persisted into the graph through the
 * existing writeFinding maker/checker path.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { DEFAULTS, type UltimatrixConfig, type BudgetPolicy } from '../config'
import { getGlobalGraphStore } from '../graph/store'
import { executeCampaign } from './executor'
import { createPrimitiveRunner } from './runner'
import { listPrimitives } from '../primitives'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { setEvidenceGateForFindings } from '../tools/control-tools'
import { getOutcomeFeedbackStore } from '../intelligence/outcome-feedback'

/**
 * Minimal config used when the tool is registered without a live config
 * (e.g. the global tool registry / tests). The brain always passes the real
 * UltimatrixConfig so rate limiting and budget policy match the session.
 */
function defaultCampaignConfig(): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    depth: DEFAULTS.depth,
    timeout: DEFAULTS.timeout,
    creds: {},
    browser: DEFAULTS.browser,
    memory: DEFAULTS.memory,
    agent: DEFAULTS.agent,
    rateLimit: { ...DEFAULTS.rateLimit, backoffSteps: [...DEFAULTS.rateLimit.backoffSteps] },
    engine: DEFAULTS.engine,
    budgetPolicy: DEFAULTS.budgetPolicy as unknown as BudgetPolicy,
  }
}

export function createCampaignTool(config: UltimatrixConfig = defaultCampaignConfig()) {
  return createTool({
    id: 'runCampaign',
    description:
      'Plan and execute a coverage campaign over the discovered endpoints. ' +
      'Builds a coverage matrix (endpoint × param × role × state × technique), ' +
      'then runs all applicable technique primitives via the plan, persisting ' +
      'evidence-gated confirmed findings into the knowledge graph. ' +
      'Returns the confirmed findings and coverage statistics. ' +
      'Use this to launch a systematic sweep instead of testing endpoints one at a time.',
    inputSchema: z.object({
      maxSlices: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Cap on number of slices to execute (highest priority first)'),
      maxConcurrency: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Bounded concurrency for slice execution'),
      includeAnonymous: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include an anonymous role for unauthenticated endpoints'),
      roleFilter: z
        .array(z.string())
        .optional()
        .describe('Only run slices for these roles'),
      techniqueFilter: z
        .array(z.string())
        .optional()
        .describe('Only run these primitive ids'),
    }),
    execute: async ({ maxSlices, maxConcurrency, includeAnonymous, roleFilter, techniqueFilter }) => {
      const graphStore = getGlobalGraphStore()
      const gate = new EvidenceGate()
      // Maker/Checker: campaign-persisted findings consult this same gate.
      setEvidenceGateForFindings(gate)

      const executor = createPrimitiveRunner(graphStore, config, gate)

      const result = await executeCampaign(graphStore, config, {
        executor,
        primitives: listPrimitives().map((p) => ({
          id: p.id,
          description: p.description,
          tags: [],
        })),
        evidenceGate: gate,
        maxConcurrency,
        onSliceComplete: async (outcome) => {
          const fbStore = getOutcomeFeedbackStore()
          for (const result of outcome.results) {
            if (result.confirmed) {
              fbStore.recordOutcome(
                `finding:${outcome.slice.endpoint.url}:${result.primitiveId}`,
                result.primitiveId,
                { accepted: true },
              )
            }
          }
        },
        planOptions: {
          maxSlices,
          includeAnonymous,
          roleFilter,
          techniqueFilter,
        },
      })

      return {
        ok: true,
        findings: result.findings,
        coverage: result.coverage,
        budgetExceeded: result.budgetExceeded,
        slicesRun: result.slicesRun,
      }
    },
  })
}

/** Default-config instance for global registries (brain passes its own config). */
export const runCampaignTool = createCampaignTool()
