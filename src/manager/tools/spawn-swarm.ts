import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'
import type { WorkerPool } from '../../workers/pool'
import type { UltimatrixConfig } from '../../config'
import { getGlobalGraphStore } from '../../graph/store'
import { getActiveBrowser } from '../../browser/manager'

export function createSpawnSwarmTool(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  workerPool: WorkerPool,
) {
  return createTool({
    id: 'spawn-swarm',
    description: 'Spawn workers on multiple endpoints. Supports parallel (independent endpoints) or sequential (chaining) execution.',
    inputSchema: z.object({
      tasks: z.array(z.object({
        skillId: z.string().describe('Skill ID for this worker'),
        task: z.string().describe('Specific task for this worker'),
        endpointId: z.string().optional().describe('Graph endpoint node ID for context'),
        tier: z.enum(['fast', 'balanced', 'powerful']).default('balanced'),
      })).describe('List of tasks to execute.'),
      parallel: z.boolean().default(false).describe('Run independent tasks in parallel. Use true for unrelated endpoints. Use false (default) when earlier workers must inform later workers.'),
      maxWorkers: z.number().int().positive().default(5).describe('Maximum workers to spawn'),
    }),
    outputSchema: z.object({
      swarmId: z.string(),
      mode: z.string(),
      workers: z.array(z.object({
        workerId: z.string(),
        skillId: z.string(),
        status: z.string(),
        result: z.unknown().optional(),
        error: z.string().optional(),
      })),
    }),
    execute: async ({ tasks, parallel, maxWorkers }) => {
      const limitedTasks = tasks.slice(0, maxWorkers)
      const swarmId = `swarm-${Date.now()}`
      const store = getGlobalGraphStore()

      async function buildInformedTask(taskDef: typeof limitedTasks[0], priorResults: typeof results): Promise<string> {
        let informedTask = taskDef.task

        if (taskDef.endpointId) {
          try {
            const endpoint = Array.from((store as any).nodes.values()).find(
              (n: any) => n.id === taskDef.endpointId
            )
            if (endpoint) {
              const p = endpoint.properties as any
              const headerLines = (p.headers || []).map((h: any) => `  ${h.name}: ${h.value}`)
              const cookieStr = (p.cookies || []).map((c: any) => `  ${c.name}=${c.value}`).join('; ')

              let endpointBlock = `${taskDef.task}\n\n## Target Endpoint\n- URL: ${p.url}\n- Method: ${p.method}\n- Params: ${JSON.stringify(p.params || [])}${p.authRequired ? '\n- Auth Required: Yes (' + (p.authType || 'unknown') + ')' : ''}`

              if (headerLines.length > 0) {
                endpointBlock += `\n\n## Captured Headers (use these in your HTTP request headers)\n${headerLines.join('\n')}`
              }
              if (cookieStr) {
                endpointBlock += `\n\n## Captured Cookies (use these in your HTTP request cookie header)\n  ${cookieStr}`
              }
              if (p.authType) {
                endpointBlock += `\n\n## Auth Type: ${p.authType} — retrieve the captured auth headers for ${p.url} to get full auth context`
              }

              informedTask = endpointBlock
            }
          } catch {
            // Fall back to raw task
          }
        }

        if (priorResults.length > 0) {
          const priorFindings = priorResults
            .filter(r => r.status === 'completed' && r.result)
            .map(r => `Worker ${r.skillId}: ${JSON.stringify(r.result).slice(0, 200)}`)
            .join('\n')
          if (priorFindings) {
            informedTask = `${informedTask}\n\n## Prior Worker Findings (use this to chain attacks)\n${priorFindings}`
          }
        }

        return informedTask
      }

      async function executeSingle(taskDef: typeof limitedTasks[0], priorResults: typeof results) {
        const informedTask = await buildInformedTask(taskDef, priorResults)
        try {
          const worker = workerPool.spawn({
            skillId: taskDef.skillId,
            task: informedTask,
            tier: taskDef.tier,
            browser: getActiveBrowser() || undefined,
          })
          const result = await worker.generate(informedTask)
          return { workerId: worker.id, skillId: taskDef.skillId, status: 'completed', result }
        } catch (error) {
          return {
            workerId: '',
            skillId: taskDef.skillId,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }

      const results: Array<{
        workerId: string
        skillId: string
        status: string
        result?: unknown
        error?: string
      }> = []

      if (parallel) {
        const settled = await Promise.allSettled(
          limitedTasks.map(taskDef => executeSingle(taskDef, []))
        )
        for (const s of settled) {
          if (s.status === 'fulfilled') {
            results.push(s.value)
          } else {
            results.push({
              workerId: '',
              skillId: 'unknown',
              status: 'failed',
              error: s.reason instanceof Error ? s.reason.message : String(s.reason),
            })
          }
        }
      } else {
        for (const taskDef of limitedTasks) {
          const result = await executeSingle(taskDef, results)
          results.push(result)
        }
      }

      return {
        ok: true,
        value: { swarmId, mode: parallel ? 'parallel' : 'sequential', workers: results }
      }
    },
  })
}
