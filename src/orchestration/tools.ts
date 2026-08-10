/**
 * Orchestration tools — Phase 9 (ORCHESTRATION-LAYER-FIX.md T4).
 *
 *  - `diagnoseTarget`   — read-only diagnosis of the captured target state.
 *                         Planning only: never executes tests, never writes findings.
 *  - `runAdvancedPlaybook` — execute the diagnosed technique plan.
 *                            Confirmed results commit only through the EvidenceGate.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { diagnoseTargetState } from './diagnosis'
import { runAdvancedPlaybook } from './playbook-runner'

export const diagnoseTargetTool = createTool({
  id: 'diagnoseTarget',
  description:
    'Diagnose the captured state of the target from the knowledge graph and ' +
    'recommend an ordered set of technique primitives to run next. ' +
    'Returns a structured diagnosis: known context, missing context, ' +
    'attack-surface signals, and ranked technique candidates with reasons. ' +
    'PLANNING ONLY — never executes tests and never writes findings.',
  inputSchema: z.object({
    target: z.string().optional().describe('Target base URL (filters endpoints by origin)'),
    includeSkills: z.boolean().optional().default(true).describe('Include skill recommendations'),
    includePrimitives: z.boolean().optional().default(true).describe('Rank technique primitives'),
    maxCandidates: z.number().int().positive().optional().describe('Cap on ranked candidates'),
  }),
  execute: async ({ target, includeSkills, includePrimitives, maxCandidates }) => {
    const profile = diagnoseTargetState({ target, includeSkills, includePrimitives, maxCandidates })
    return { ok: true, profile }
  },
})

export const runAdvancedPlaybookTool = createTool({
  id: 'runAdvancedPlaybook',
  description:
    'Run the diagnosed technique plan against the target. ' +
    'Executes the highest-ranked primitive candidates (or the ones you select ' +
    'by id from a diagnoseTarget result). Direct primitives run evidence-gated ' +
    'and only confirmed results persist. Candidates that require worker ' +
    'exploration are reported as skipped when no worker delegate is configured. ' +
    'Returns per-candidate results, confirmation counts, and the remaining ' +
    'missing-context gaps.',
  inputSchema: z.object({
    candidateIds: z
      .array(z.string())
      .optional()
      .describe('Candidate ids from a diagnoseTarget result to run. Omit to run the highest-ranked'),
    maxCandidates: z.number().int().positive().optional().describe('Cap on candidates to execute'),
    commit: z.boolean().optional().default(true).describe('Persist evidence-gated confirmed findings to the graph'),
  }),
  execute: async ({ candidateIds, maxCandidates, commit }) => {
    const result = await runAdvancedPlaybook({ candidateIds, maxCandidates, commit })
    return { ok: true, result }
  },
})

export { diagnoseTargetState } from './diagnosis'
export { runAdvancedPlaybook } from './playbook-runner'
export { rankTechniqueCandidates, buildAdvancedPlaybook } from './technique-planner'
