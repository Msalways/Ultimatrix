import { createTool } from '@mastra/core/tools'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'
import type { UltimatrixConfig } from '../../config'
import type { ModelSelector } from '../../models/selector'
import { getGlobalGraphStore } from '../../graph/store'
import { emitWorkerSpawned, emitWorkerStarted, emitWorkerCompleted, emitWorkerError } from '../../events/emitter'
import { getGlobalDecisionLedger } from '../../security/decision-ledger'
import type { TaskCoordinator } from '../../runtime/task-coordinator'

export function createSpawnWorkerTool(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  taskCoordinator: TaskCoordinator,
  modelSelector?: ModelSelector,
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
      complexity: z.enum(['low', 'medium', 'high', 'critical']).default('medium').describe('Task complexity used for model routing'),
      requiredCapabilities: z.array(z.string()).optional().describe('Model strengths needed for this worker'),
      tokenBudget: z.number().optional().describe('Token budget for this worker'),
      timeoutMs: z.number().int().positive().optional().describe('Wall-clock deadline for this worker'),
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
      routing: z.object({
        tier: z.string(),
        modelId: z.string().optional(),
        provider: z.string().optional(),
        reasoning: z.string().optional(),
      }).optional(),
    }),
    execute: async ({ skillId, task, endpointId, tier, modelId, complexity, requiredCapabilities, tokenBudget, timeoutMs }, context) => {

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
      let workerId = ''
      let workerName = `${skillId} Specialist`
      try {
        if (!skillRegistry.has(skillId)) throw new Error(`Skill not found: ${skillId}`)
        const taskComplexity = complexity ?? 'medium'
        const selection = !modelId && modelSelector
          ? modelSelector.selectForTask({ skillId, taskDescription: informedTask, complexity: taskComplexity, requiredCapabilities }, 'worker')
          : undefined
        const routedTier = (selection?.tier ?? tier) as 'fast' | 'balanced' | 'powerful'
        const routedModelId = modelId ?? selection?.modelId
        const taskId = `task-${randomUUID()}`

        getGlobalDecisionLedger().recordDecision({
          kind: 'worker.spawn',
          reason: `spawn ${skillId} specialist worker`,
          routingReason: selection?.reasoning,
          provider: selection?.provider,
          model: routedModelId,
          sourceRefs: [taskId, `tier:${routedTier}`, ...(endpointId ? [endpointId] : [])],
        })

        const taskState = await taskCoordinator.run({
          taskId,
          objective: informedTask,
          skillId,
          contextRefs: endpointId ? [endpointId] : [],
          requiredCapabilities,
          complexity: taskComplexity,
          tokenLimit: tokenBudget,
          timeoutMs,
          modelId: routedModelId,
          provider: selection?.provider,
          tier: routedTier,
          signal: (context as any)?.abortSignal,
          onWorkerAssigned: (worker) => {
            workerId = worker.workerId
            workerName = worker.workerName
            emitWorkerSpawned(workerId, workerName, skillId, task, { endpointId, tier: routedTier, modelId: routedModelId, tokenBudget, routingReason: selection?.reasoning })
            emitWorkerStarted(workerId, workerName, skillId, task)
          },
        })
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

        if (taskState.status !== 'completed') {
          emitWorkerError(workerId, workerName, skillId, task, taskState.error ?? taskState.status, durationMs)
          return { workerId, status: taskState.status, error: taskState.error, graphDiff }
        }

        emitWorkerCompleted(workerId, workerName, skillId, task, 'completed', { result: taskState.resultSummary, durationMs, graphDiff: { nodesAdded: graphDiff.nodesAdded, findingsAdded: graphDiff.findingsAdded } })

        // Cap worker result: return only compact fields, NOT the full FullOutput.
        // FullOutput contains steps/toolCalls/toolResults which are unbounded and
        // would bloat the brain's context if included.
        const compactResult = {
          text: taskState.resultSummary ?? '',
          findingsCount: graphDiff.findingsAdded,
          nodesAdded: graphDiff.nodesAdded,
          durationMs,
        }

        return {
          workerId,
          status: 'completed',
          result: compactResult,
          graphDiff,
          routing: {
            tier: routedTier,
            modelId: routedModelId,
            provider: selection?.provider,
            reasoning: selection?.reasoning ?? (modelId ? 'explicit modelId override' : undefined),
          },
        }
      } catch (error) {
        const durationMs = Date.now() - startTime
        const nodesAfter = store.queryNodes().length
        const findingsAfter = store.queryNodes(undefined, { type: 'Finding' } as any).length
        const errorMsg = error instanceof Error ? error.message : String(error)

        emitWorkerError(workerId, workerName, skillId, task, errorMsg, durationMs)

        return {
          workerId,
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
        }
      }
    },
  })
}
