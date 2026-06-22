import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'
import type { WorkerPool } from '../../workers/pool'
import type { UltimatrixConfig } from '../../config'

export function createSpawnWorkerTool(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  workerPool: WorkerPool,
) {
  return createTool({
    id: 'spawn-worker',
    description: 'Spawn a specialized worker agent for a specific skill/task',
    inputSchema: z.object({
      skillId: z.string().describe('ID of the skill to spawn worker for'),
      task: z.string().describe('Task description for the worker'),
      tier: z.enum(['fast', 'balanced', 'powerful']).default('balanced').describe('Model tier to use'),
    }),
    outputSchema: z.object({
      workerId: z.string(),
      status: z.string(),
      result: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ context }) => {
      const { skillId, task, tier } = context

      try {
        const worker = workerPool.spawn({ skillId, task, tier })

        return {
          workerId: worker.id,
          status: 'spawned',
          result: await worker.generate(task),
        }
      } catch (error) {
        return {
          workerId: '',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
}
