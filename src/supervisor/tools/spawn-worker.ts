import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { WorkerPool } from '../../workers/pool'
import type { SkillRegistry } from '../../skills/registry'
import type { UltimatrixConfig } from '../../config'

export function createSpawnWorkerTool(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  workerPool: WorkerPool,
) {
  return createTool({
    id: 'spawn_worker',
    description: 'Spawn a specialist worker with a specific skill and model tier. Use for focused tasks that need expertise.',
    inputSchema: z.object({
      skillId: z.string().describe('Skill ID for the worker'),
      modelTier: z.enum(['fast', 'balanced', 'powerful']).describe('Model tier: fast for recon, balanced for most attacks, powerful for complex logic'),
      task: z.string().describe('Detailed task description for the worker'),
      context: z.any().optional().describe('Additional context (target URL, endpoint, etc.)'),
    }),
    execute: async ({ skillId, modelTier, task, context }) => {
      try {
        const worker = workerPool.spawn({ skillId, task, tier: modelTier })

        const result = await worker.generate(task)

        return {
          ok: true,
          value: {
            workerId: worker.id,
            skillId,
            modelTier,
            result: result.text,
            toolCalls: result.toolCalls?.length || 0,
          },
        }
      } catch (e) {
        return {
          ok: false,
          error: `Spawn worker failed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    },
  })
}
