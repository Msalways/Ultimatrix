import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'
import type { WorkerPool } from '../../workers/pool'
import type { UltimatrixConfig } from '../../config'
import { getGlobalGraphStore } from '../../graph/store'
import { EndpointNode } from '../../graph/schema'
import { getActiveBrowser } from '../../browser/manager'

export function createSpawnWorkerTool(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  workerPool: WorkerPool,
) {
  return createTool({
    id: 'spawn-worker',
    description: 'Spawn a specialized worker agent with informed context about a specific endpoint. Always pass endpointId so the worker knows exactly what to test.',
    inputSchema: z.object({
      skillId: z.string().describe('ID of the skill to spawn worker for'),
      task: z.string().describe('Specific task description for the worker'),
      endpointId: z.string().optional().describe('Graph endpoint node ID — worker will receive full endpoint details'),
      tier: z.enum(['fast', 'balanced', 'powerful']).default('balanced').describe('Model tier to use'),
    }),
    outputSchema: z.object({
      workerId: z.string(),
      status: z.string(),
      result: z.unknown().optional(),
      error: z.string().optional(),
      graphDiff: z.object({
        nodesBefore: z.number(),
        nodesAfter: z.number(),
        nodesAdded: z.number(),
        findingsBefore: z.number(),
        findingsAfter: z.number(),
        findingsAdded: z.number(),
      }).optional(),
    }),
    execute: async ({ skillId, task, endpointId, tier }) => {

      // SUPERVISOR-1: Snapshot graph before spawning
      const store = getGlobalGraphStore()
      const nodesBefore = store.queryNodes().length
      const findingsBefore = store.queryNodes(undefined, { type: 'Finding' } as any).length

      let informedTask = task
      if (endpointId) {
        try {
          const endpoint = store.queryNodes(undefined, { id: endpointId } as any)[0]
            || Array.from((store as any).nodes.values()).find((n: any) => n.id === endpointId)
          if (endpoint) {
            const p = endpoint.properties as any
            const headerLines = (p.headers || []).map((h: any) => `  ${h.name}: ${h.value}`)
            const cookieStr = (p.cookies || []).map((c: any) => `  ${c.name}=${c.value}`).join('; ')

            let endpointBlock = `${task}\n\n## Target Endpoint\n- URL: ${p.url}\n- Method: ${p.method}\n- Params: ${JSON.stringify(p.params || [])}${p.authRequired ? '\n- Auth Required: Yes (' + (p.authType || 'unknown') + ')' : ''}${p.tags ? '\n- Tags: ' + p.tags.join(', ') : ''}`

            if (headerLines.length > 0) {
              endpointBlock += `\n\n## Captured Headers (use these in httpRequest headers)\n${headerLines.join('\n')}`
            }
            if (cookieStr) {
              endpointBlock += `\n\n## Captured Cookies (use these in httpRequest headers.cookie)\n  ${cookieStr}`
            }
            if (p.authType) {
              endpointBlock += `\n\n## Auth Type: ${p.authType} — use getCapturedHeaders("${p.url}") for full auth context`
            }

            informedTask = endpointBlock
          }
        } catch {
          // Fall back to raw task
        }
      }

      try {
        const worker = workerPool.spawn({ skillId, task: informedTask, tier, browser: getActiveBrowser() || undefined })
        const result = await worker.generate(informedTask)

        // SUPERVISOR-1: Snapshot graph after worker completes
        const nodesAfter = store.queryNodes().length
        const findingsAfter = store.queryNodes(undefined, { type: 'Finding' } as any).length

        return {
          workerId: worker.id,
          status: 'spawned',
          result,
          graphDiff: {
            nodesBefore,
            nodesAfter,
            nodesAdded: nodesAfter - nodesBefore,
            findingsBefore,
            findingsAfter,
            findingsAdded: findingsAfter - findingsBefore,
          },
        }
      } catch (error) {
        const nodesAfter = store.queryNodes().length
        const findingsAfter = store.queryNodes(undefined, { type: 'Finding' } as any).length

        return {
          workerId: '',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          graphDiff: {
            nodesBefore,
            nodesAfter,
            nodesAdded: nodesAfter - nodesBefore,
            findingsBefore,
            findingsAfter,
            findingsAdded: findingsAfter - findingsBefore,
          },
        }
      }
    },
  })
}
