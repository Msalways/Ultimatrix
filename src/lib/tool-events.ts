import { EventEmitter } from 'events'

export interface ToolEvent {
  type: 'tool-call' | 'tool-result' | 'error' | 'info' | 'reasoning' | 'agent-start' | 'agent-end'
  message: string
  timestamp: number
  toolName?: string
  details?: Record<string, unknown>
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
  }
}

export function getToolEventEmitter(): ToolEventEmitter {
  return ToolEventEmitter.getInstance()
}
