import { createTool } from '@mastra/core/tools'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'
import type { UltimatrixConfig } from '../../config'
import type { ModelSelector } from '../../models/selector'
import { getGlobalGraphStore } from '../../graph/store'
import {
  emitSwarmStarted,
  emitSwarmWorkerDispatched,
  emitSwarmWorkerCompleted,
  emitSwarmCompleted,
  emitSwarmSequentialNext,
  emitSwarmParallelProgress,
  emitWorkerSpawned,
  emitWorkerStarted,
  emitWorkerCompleted,
  emitWorkerError,
} from '../../events/emitter'
import { getGlobalDecisionLedger } from '../../security/decision-ledger'
import type { TaskCoordinator } from '../../runtime/task-coordinator'

export function createSpawnSwarmTool(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  taskCoordinator: TaskCoordinator,
  modelSelector?: ModelSelector,
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
        modelId: z.string().optional().describe('Explicit model ID override'),
        complexity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
        requiredCapabilities: z.array(z.string()).optional(),
        tokenBudget: z.number().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
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
        routing: z.object({
          tier: z.string(),
          modelId: z.string().optional(),
          provider: z.string().optional(),
          reasoning: z.string().optional(),
        }).optional(),
      })),
    }),
    execute: async ({ tasks, parallel, maxWorkers }, context) => {
      const limitedTasks = tasks.slice(0, maxWorkers)
      const swarmId = `swarm-${Date.now()}`
      const store = getGlobalGraphStore()
      const swarmStartTime = Date.now()

      // Emit swarm started
      emitSwarmStarted(swarmId, parallel ? 'parallel' : 'sequential', limitedTasks.length,
        limitedTasks.map(t => ({ skillId: t.skillId, task: t.task })))

      async function buildInformedTask(taskDef: typeof limitedTasks[0], priorResults: typeof results): Promise<string> {
        let informedTask = taskDef.task

        if (taskDef.endpointId) {
          try {
            const endpoint = Array.from((store as any).nodes.values()).find(
              (n: any) => n.id === taskDef.endpointId
            )
            if (endpoint) {
              const p = (endpoint as any).properties as any
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

      async function executeSingle(taskDef: typeof limitedTasks[0], priorResults: typeof results, index: number) {
        const informedTask = await buildInformedTask(taskDef, priorResults)
        const workerStartTime = Date.now()
        let workerId = ''
        let workerName = `${taskDef.skillId} Specialist`

        try {
          if (!skillRegistry.has(taskDef.skillId)) throw new Error(`Skill not found: ${taskDef.skillId}`)
          const taskComplexity = taskDef.complexity ?? 'medium'
          const selection = !taskDef.modelId && modelSelector
            ? modelSelector.selectForTask({
              skillId: taskDef.skillId,
              taskDescription: informedTask,
              complexity: taskComplexity,
              requiredCapabilities: taskDef.requiredCapabilities,
            }, 'worker')
            : undefined
          const routedTier = (selection?.tier ?? taskDef.tier) as 'fast' | 'balanced' | 'powerful'
          const routedModelId = taskDef.modelId ?? selection?.modelId
          const taskId = `task-${randomUUID()}`

          getGlobalDecisionLedger().recordDecision({
            kind: 'worker.spawn',
            reason: `spawn ${taskDef.skillId} specialist worker (swarm ${swarmId})`,
            routingReason: selection?.reasoning,
            provider: selection?.provider,
            model: routedModelId,
            sourceRefs: [taskId, swarmId, `tier:${routedTier}`],
          })

          const taskState = await taskCoordinator.run({
            taskId,
            objective: informedTask,
            skillId: taskDef.skillId,
            contextRefs: taskDef.endpointId ? [taskDef.endpointId] : [],
            requiredCapabilities: taskDef.requiredCapabilities,
            complexity: taskComplexity,
            tokenLimit: taskDef.tokenBudget,
            timeoutMs: taskDef.timeoutMs,
            modelId: routedModelId,
            provider: selection?.provider,
            tier: routedTier,
            signal: (context as any)?.abortSignal,
            onWorkerAssigned: (worker) => {
              workerId = worker.workerId
              workerName = worker.workerName
              emitWorkerSpawned(workerId, workerName, taskDef.skillId, taskDef.task, { tier: routedTier, modelId: routedModelId, routingReason: selection?.reasoning })
              emitWorkerStarted(workerId, workerName, taskDef.skillId, taskDef.task)
              emitSwarmWorkerDispatched(swarmId, workerId, workerName, taskDef.skillId, taskDef.task, index, limitedTasks.length)
            },
          })
          const durationMs = Date.now() - workerStartTime

          if (taskState.status !== 'completed') {
            const error = taskState.error ?? taskState.status
            emitWorkerError(workerId, workerName, taskDef.skillId, taskDef.task, error, durationMs)
            emitSwarmWorkerCompleted(swarmId, workerId, workerName, taskDef.skillId, 'failed', undefined, durationMs)
            return { workerId, skillId: taskDef.skillId, status: taskState.status, error }
          }

          emitWorkerCompleted(workerId, workerName, taskDef.skillId, taskDef.task, 'completed', { result: taskState.resultSummary, durationMs })
          emitSwarmWorkerCompleted(swarmId, workerId, workerName, taskDef.skillId, 'completed', taskState.resultSummary, durationMs)

          // Cap worker result: only compact fields, NOT the full FullOutput
          const compactResult = {
            text: taskState.resultSummary ?? '',
            durationMs,
          }

          return {
            workerId,
            skillId: taskDef.skillId,
            status: 'completed',
            result: compactResult,
            routing: {
              tier: routedTier,
              modelId: routedModelId,
              provider: selection?.provider,
              reasoning: selection?.reasoning ?? (taskDef.modelId ? 'explicit modelId override' : undefined),
            },
          }
        } catch (error) {
          const durationMs = Date.now() - workerStartTime
          const errorMsg = error instanceof Error ? error.message : String(error)

          emitWorkerError(workerId, workerName, taskDef.skillId, taskDef.task, errorMsg, durationMs)
          emitSwarmWorkerCompleted(swarmId, workerId, workerName, taskDef.skillId, 'failed', undefined, durationMs)

          return {
            workerId,
            skillId: taskDef.skillId,
            status: 'failed',
            error: errorMsg,
          }
        }
      }

      const results: Array<{
        workerId: string
        skillId: string
        status: string
        result?: unknown
        error?: string
        routing?: {
          tier: string
          modelId?: string
          provider?: string
          reasoning?: string
        }
      }> = []

      let completedCount = 0
      let failedCount = 0

      if (parallel) {
        const settled = await Promise.allSettled(
          limitedTasks.map((taskDef, i) => executeSingle(taskDef, [], i))
        )
        for (const s of settled) {
          if (s.status === 'fulfilled') {
            results.push(s.value)
            if (s.value.status === 'completed') completedCount++
            else failedCount++
          } else {
            results.push({
              workerId: '',
              skillId: 'unknown',
              status: 'failed',
              error: s.reason instanceof Error ? s.reason.message : String(s.reason),
            })
            failedCount++
          }
        }
        // Final parallel progress
        emitSwarmParallelProgress(swarmId, 0, completedCount, failedCount, limitedTasks.length)
      } else {
        for (let i = 0; i < limitedTasks.length; i++) {
          const taskDef = limitedTasks[i]
          if (i > 0) {
            emitSwarmSequentialNext(swarmId, '', `${taskDef.skillId} Specialist`, taskDef.skillId, taskDef.task, results.length)
          }
          const result = await executeSingle(taskDef, results, i)
          results.push(result)
          if (result.status === 'completed') completedCount++
          else failedCount++
        }
      }

      const totalDurationMs = Date.now() - swarmStartTime
      emitSwarmCompleted(swarmId, parallel ? 'parallel' : 'sequential', limitedTasks.length, completedCount, failedCount, totalDurationMs)

      return { swarmId, mode: parallel ? 'parallel' : 'sequential', workers: results }
    },
  })
}
