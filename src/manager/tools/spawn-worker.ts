import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'
import type { WorkerPool } from '../../workers/pool'
import type { UltimatrixConfig } from '../../config'
import { getGlobalGraphStore } from '../../graph/store'
import { getActiveBrowser } from '../../browser/manager'
import { emitWorkerSpawned, emitWorkerStarted, emitWorkerCompleted, emitWorkerError } from '../../events/emitter'

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
      modelId: z.string().optional().describe('Explicit model ID override (e.g., "groq/llama3-8b-8192")'),
      tokenBudget: z.number().optional().describe('Token budget for this worker'),
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
    execute: async ({ skillId, task, endpointId, tier, modelId, tokenBudget }, _context) => {

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

      const startTime = Date.now()
      try {
        const worker = workerPool.spawn({ skillId, task: informedTask, tier, modelId, tokenBudget, browser: getActiveBrowser() || undefined })
        const workerName = (worker as any).name ?? `${skillId} Specialist`

        // Emit lifecycle events
        emitWorkerSpawned(worker.id, workerName, skillId, task, { endpointId, tier, modelId, tokenBudget })
        emitWorkerStarted(worker.id, workerName, skillId, task)

        const result = await worker.generate(informedTask)
        const durationMs = Date.now() - startTime

        // SUPERVISOR-1: Snapshot graph after worker completes
        const nodesAfter = store.queryNodes().length
        const findingsAfter = store.queryNodes(undefined, { type: 'Finding' } as any).length
        const graphDiff = {
          nodesBefore,
          nodesAfter,
          nodesAdded: nodesAfter - nodesBefore,
          findingsBefore,
          findingsAfter,
          findingsAdded: findingsAfter - findingsBefore,
        }

        emitWorkerCompleted(worker.id, workerName, skillId, task, 'completed', { result, durationMs, graphDiff: { nodesAdded: graphDiff.nodesAdded, findingsAdded: graphDiff.findingsAdded } })

        // Cap worker result: return only compact fields, NOT the full FullOutput.
        // FullOutput contains steps/toolCalls/toolResults which are unbounded and
        // would bloat the brain's context if included.
        const compactResult = {
          text: typeof (result as any)?.text === 'string' ? (result as any).text.slice(0, 2000) : '',
          findingsCount: graphDiff.findingsAdded,
          nodesAdded: graphDiff.nodesAdded,
          durationMs,
        }

        return {
          ok: true,
          value: {
            workerId: worker.id,
            status: 'completed',
            result: compactResult,
            graphDiff,
          },
        } as any
      } catch (error) {
        const durationMs = Date.now() - startTime
        const nodesAfter = store.queryNodes().length
        const findingsAfter = store.queryNodes(undefined, { type: 'Finding' } as any).length
        const errorMsg = error instanceof Error ? error.message : String(error)

        emitWorkerError('', `${skillId} Specialist`, skillId, task, errorMsg, durationMs)

        return {
          ok: false,
          value: {
            workerId: '',
            status: 'failed',
            error: errorMsg,
            graphDiff: {
              nodesBefore,
              nodesAfter,
              nodesAdded: nodesAfter - nodesBefore,
              findingsBefore,
              findingsAfter,
              findingsAdded: findingsAfter - findingsBefore,
            },
          },
        } as any
      }
    },
  })
}
