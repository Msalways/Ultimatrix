import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { WorkerPool } from '../../workers/pool'
import type { SkillRegistry } from '../../skills/registry'
import { runSwarm } from '../../swarm/builder'

export function createSpawnSwarmTool(
  skillRegistry: SkillRegistry,
  workerPool: WorkerPool,
) {
  return createTool({
    id: 'spawn_swarm',
    description: 'Spawn multiple workers in parallel for comprehensive testing. Use when multiple attack surfaces need simultaneous testing.',
    inputSchema: z.object({
      tasks: z.array(z.object({
        skillId: z.string(),
        modelTier: z.enum(['fast', 'balanced', 'powerful']),
        task: z.string(),
        context: z.any().optional(),
      })).describe('Array of tasks to run in parallel'),
    }),
    execute: async ({ tasks }) => {
      try {
        const result = await runSwarm({ tasks, skillRegistry, workerPool })
        return {
          ok: true,
          value: result,
        }
      } catch (e) {
        return {
          ok: false,
          error: `Swarm execution failed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    },
  })
}
