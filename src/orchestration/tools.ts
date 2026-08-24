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
import type { TaskCoordinator } from '../runtime/task-coordinator'

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

const runAdvancedPlaybookDescription =
  'Run the diagnosed technique plan against the target. ' +
  'Direct primitives run evidence-gated and worker candidates delegate through the runtime coordinator.'

const runAdvancedPlaybookInput = z.object({
    candidateIds: z
      .array(z.string())
      .optional()
      .describe('Candidate ids from a diagnoseTarget result to run. Omit to run the highest-ranked'),
    maxCandidates: z.number().int().positive().optional().describe('Cap on candidates to execute'),
    commit: z.boolean().optional().default(true).describe('Persist evidence-gated confirmed findings to the graph'),
})

export function createRunAdvancedPlaybookTool(
  coordinator: TaskCoordinator,
  runner: typeof runAdvancedPlaybook = runAdvancedPlaybook,
) {
  return createTool({
    id: 'runAdvancedPlaybook',
    description: runAdvancedPlaybookDescription,
    inputSchema: runAdvancedPlaybookInput,
    execute: async ({ candidateIds, maxCandidates, commit }) => ({
      ok: true,
      result: await runner({ candidateIds, maxCandidates, commit }, {
        delegateWorker: async (candidate) => {
          if (!candidate.workerId) throw new Error(`Candidate ${candidate.id} has no worker skill`)
          const task = await coordinator.run({
            objective: candidate.reason,
            skillId: candidate.workerId,
            complexity: 'medium',
          })
          return {
            ok: task.status === 'completed',
            note: task.resultSummary ?? task.error ?? `Task ended as ${task.status}`,
          }
        },
      }),
    }),
  })
}

export { diagnoseTargetState } from './diagnosis'
export { runAdvancedPlaybook } from './playbook-runner'
export { rankTechniqueCandidates, buildAdvancedPlaybook } from './technique-planner'
