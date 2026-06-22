import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'
import type { WorkerPool } from '../../workers/pool'
import type { UltimatrixConfig } from '../../config'

export function createSpawnSwarmTool(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  workerPool: WorkerPool,
) {
  return createTool({
    id: 'spawn-swarm',
    description: 'Spawn multiple workers in parallel for a swarm attack',
    inputSchema: z.object({
      skillIds: z.array(z.string()).describe('IDs of skills to spawn workers for'),
      task: z.string().describe('Task description for all workers'),
      tier: z.enum(['fast', 'balanced', 'powerful']).default('balanced').describe('Model tier to use'),
      maxWorkers: z.number().int().positive().default(5).describe('Maximum workers to spawn'),
    }),
    outputSchema: z.object({
      swarmId: z.string(),
      workers: z.array(z.object({
        workerId: z.string(),
        skillId: z.string(),
        status: z.string(),
        result: z.unknown().optional(),
        error: z.string().optional(),
      })),
    }),
    execute: async ({ context }) => {
      const { skillIds, task, tier, maxWorkers } = context

      const limitedSkills = skillIds.slice(0, maxWorkers)
      const swarmId = `swarm-${Date.now()}`

      const workers = await Promise.all(
        limitedSkills.map(async (skillId: string) => {
          try {
            const worker = workerPool.spawn({ skillId, task, tier })
            const result = await worker.generate(task)
            return { workerId: worker.id, skillId, status: 'completed', result }
          } catch (error) {
            return {
              workerId: '',
              skillId,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            }
          }
        }),
      )

      return { swarmId, workers }
    },
  })
}
