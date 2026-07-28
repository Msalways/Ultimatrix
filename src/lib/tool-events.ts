import { EventEmitter } from 'events'
import { getGlobalEmitter } from '../events/emitter'

export interface ToolEvent {
  type: 'tool-call' | 'tool-result' | 'error' | 'info' | 'reasoning' | 'agent-start' | 'agent-end'
  message: string
  timestamp: number
  toolName?: string
  details?: Record<string, unknown>
  /** Worker context — present when the tool runs inside a spawned worker. */
  workerId?: string
  workerName?: string
  workerSkill?: string
}

class ToolEventEmitter extends EventEmitter {
  private static instance: ToolEventEmitter

  static getInstance(): ToolEventEmitter {
    if (!ToolEventEmitter.instance) {
      ToolEventEmitter.instance = new ToolEventEmitter()
      ToolEventEmitter.instance.setMaxListeners(100)
    }
    return ToolEventEmitter.instance
  }

  push(event: ToolEvent): void {
    this.emit('event', event)
    // Bridge to TypedEventEmitter so the global bus gets all tool events.
    // The bridge maps ToolEvent.type → EventMap key and enriches with worker context.
    try {
      const bus = getGlobalEmitter()
      const base = { timestamp: event.timestamp }
      const workerCtx = event.workerId
        ? { workerId: event.workerId, workerName: event.workerName, workerSkill: event.workerSkill }
        : {}

      switch (event.type) {
        case 'tool-call':
          bus.emit('tool:call', {
            toolName: event.toolName ?? 'unknown',
            args: event.details as Record<string, unknown> | undefined,
            ...workerCtx,
            ...base,
          })
          break
        case 'tool-result':
          bus.emit('tool:result', {
            toolName: event.toolName ?? 'unknown',
            ok: true,
            result: event.message,
            ...workerCtx,
            ...base,
          })
          break
        case 'error':
          bus.emit('tool:error', {
            toolName: event.toolName ?? 'unknown',
            error: event.message,
            ...workerCtx,
            ...base,
          })
          break
        case 'agent-start':
          bus.emit('solver:start', {
            target: '',
            engine: 'solver',
            ...base,
          })
          break
        case 'agent-end':
          bus.emit('solver:complete', {
            completed: true,
            reason: 'completed',
            steps: 0,
            toolCalls: 0,
            tokensUsed: 0,
            durationMs: 0,
            ...base,
          })
          break
        default:
          break
      }
    } catch {
      // Bus not initialized yet — ignore
    }
  }
}

export function getToolEventEmitter(): ToolEventEmitter {
  return ToolEventEmitter.getInstance()
}
