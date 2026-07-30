import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'
import type { WorkerPool } from '../../workers/pool'
import type { UltimatrixConfig } from '../../config'
import { getGlobalGraphStore } from '../../graph/store'
import { getActiveBrowser } from '../../browser/manager'
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
    execute: async ({ tasks, parallel, maxWorkers }, _context) => {
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

        try {
          const worker = workerPool.spawn({
            skillId: taskDef.skillId,
            task: informedTask,
            tier: taskDef.tier,
            browser: getActiveBrowser() || undefined,
          })
          const workerName = (worker as any).name ?? `${taskDef.skillId} Specialist`

          // Emit worker lifecycle
          emitWorkerSpawned(worker.id, workerName, taskDef.skillId, taskDef.task)
          emitWorkerStarted(worker.id, workerName, taskDef.skillId, taskDef.task)
          emitSwarmWorkerDispatched(swarmId, worker.id, workerName, taskDef.skillId, taskDef.task, index, limitedTasks.length)

          const result = await worker.generate(informedTask)
          const durationMs = Date.now() - workerStartTime

          emitWorkerCompleted(worker.id, workerName, taskDef.skillId, taskDef.task, 'completed', { result, durationMs })
          emitSwarmWorkerCompleted(swarmId, worker.id, workerName, taskDef.skillId, 'completed', result, durationMs)

          // Cap worker result: only compact fields, NOT the full FullOutput
          const compactResult = {
            text: typeof (result as any)?.text === 'string' ? (result as any).text.slice(0, 2000) : '',
            durationMs,
          }

          return { workerId: worker.id, skillId: taskDef.skillId, status: 'completed', result: compactResult }
        } catch (error) {
          const durationMs = Date.now() - workerStartTime
          const errorMsg = error instanceof Error ? error.message : String(error)

          emitWorkerError('', `${taskDef.skillId} Specialist`, taskDef.skillId, taskDef.task, errorMsg, durationMs)
          emitSwarmWorkerCompleted(swarmId, '', `${taskDef.skillId} Specialist`, taskDef.skillId, 'failed', undefined, durationMs)

          return {
            workerId: '',
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

      return {
        ok: true,
        value: { swarmId, mode: parallel ? 'parallel' : 'sequential', workers: results }
      } as any
    },
  })
}
