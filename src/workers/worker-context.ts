/**
 * WorkerContext — wraps a spawned worker's identity and intercepts tool
 * calls to emit both `worker:*` and enriched `tool:*` events.
 *
 * Usage:
 *   const ctx = new WorkerContext(worker.id, workerName, skillId, task)
 *   ctx.wrap(worker)  // monkey-patches agent.generate to intercept tool calls
 *
 * No regex, no substring detection. Structured typed fields at all seams.
 */

import {emitWorkerToolCall, emitWorkerToolResult} from '../events/emitter'
import { getToolEventEmitter, type ToolEvent } from '../lib/tool-events'

export class WorkerContext {
  readonly workerId: string
  readonly workerName: string
  readonly skillId: string
  readonly task: string
  private toolCallCount = 0
  private toolCalls: Array<{ name: string; ok: boolean; durationMs?: number }> = []

  constructor(workerId: string, workerName: string, skillId: string, task: string) {
    this.workerId = workerId
    this.workerName = workerName
    this.skillId = skillId
    this.task = task
  }

  /** Get summary stats for this worker's execution. */
  getStats(): { toolCalls: number; toolCallDetails: Array<{ name: string; ok: boolean; durationMs?: number }> } {
    return { toolCalls: this.toolCallCount, toolCallDetails: [...this.toolCalls] }
  }

  /** Emit a tool-call event attributed to this worker. */
  emitToolCall(toolName: string, args?: Record<string, unknown>): void {
    this.toolCallCount++
    const workerCtx = { workerId: this.workerId, workerName: this.workerName, workerSkill: this.skillId }

    // Emit on the global typed bus
    emitWorkerToolCall(this.workerId, this.workerName, this.skillId, toolName, args)

    // Also emit on ToolEventEmitter for the legacy activity panel
    const toolEvent: ToolEvent = {
      type: 'tool-call',
      message: `Worker ${this.workerName} called ${toolName}`,
      timestamp: Date.now(),
      toolName,
      details: args,
      ...workerCtx,
    }
    getToolEventEmitter().push(toolEvent)
  }

  /** Emit a tool-result event attributed to this worker. */
  emitToolResult(toolName: string, ok: boolean, durationMs?: number): void {
    const workerCtx = { workerId: this.workerId, workerName: this.workerName }
    this.toolCalls.push({ name: toolName, ok, durationMs })

    emitWorkerToolResult(this.workerId, this.workerName, this.skillId, toolName, ok, durationMs)

    const toolEvent: ToolEvent = {
      type: ok ? 'tool-result' : 'error',
      message: ok
        ? `Worker ${this.workerName} completed ${toolName}`
        : `Worker ${this.workerName} failed ${toolName}`,
      timestamp: Date.now(),
      toolName,
      ...workerCtx,
    }
    getToolEventEmitter().push(toolEvent)
  }

  /**
   * Wrap an agent's generate method to intercept tool calls.
   * This is a best-effort interception — Mastra agents may not expose
   * internal tool-call hooks directly. The primary event emission happens
   * in spawn-worker.ts/spawn-swarm.ts at the lifecycle boundary.
   */
  wrap(agent: any): void {
    if (!agent || typeof agent.generate !== 'function') return

    const originalGenerate = agent.generate.bind(agent)
    const ctx = this as WorkerContext

    agent.generate = async function (prompt: string, opts?: any) {
      ctx.emitToolCall('agent:generate', { promptLength: prompt.length })

      const startTime = Date.now()
      try {
        const result = await originalGenerate(prompt, opts)
        ctx.emitToolResult('agent:generate', true, Date.now() - startTime)
        return result
      } catch (err) {
        ctx.emitToolResult('agent:generate', false, Date.now() - startTime)
        throw err
      }
    }
  }
}

/**
 * Create a WorkerContext and optionally wrap the agent.
 */
export function createWorkerContext(
  workerId: string,
  workerName: string,
  skillId: string,
  task: string,
  agent?: any,
): WorkerContext {
  const ctx = new WorkerContext(workerId, workerName, skillId, task)
  if (agent) ctx.wrap(agent)
  return ctx
}
