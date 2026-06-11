import { EventEmitter } from 'node:events'

interface EventMap {
  'activity:start': { worker: string; task: string }
  'activity:complete': { worker: string; result: string }
  'activity:error': { worker: string; error: string }
  'finding': { technique: string; severity: string; endpoint: string }
  'graph:update': { action: string; nodeType: string }
  'spider:progress': { url: string; status: number }
  'recorder:interaction': { type: string; description: string }
}

type EventPayload<E extends keyof EventMap> = EventMap[E]

class TypedEventEmitter {
  private emitter = new EventEmitter()

  on<E extends keyof EventMap>(event: E, listener: (payload: EventPayload<E>) => void): void {
    this.emitter.on(event, listener)
  }

  off<E extends keyof EventMap>(event: E, listener: (payload: EventPayload<E>) => void): void {
    this.emitter.off(event, listener)
  }

  emit<E extends keyof EventMap>(event: E, payload: EventPayload<E>): boolean {
    return this.emitter.emit(event, payload)
  }

  once<E extends keyof EventMap>(event: E, listener: (payload: EventPayload<E>) => void): void {
    this.emitter.once(event, listener)
  }

  removeAllListeners<E extends keyof EventMap>(event?: E): void {
    if (event) {
      this.emitter.removeAllListeners(event as string)
    } else {
      this.emitter.removeAllListeners()
    }
  }
}

let _globalEmitter: TypedEventEmitter | null = null

export function getGlobalEmitter(): TypedEventEmitter {
  if (!_globalEmitter) {
    _globalEmitter = new TypedEventEmitter()
  }
  return _globalEmitter
}

export function emitActivityStart(worker: string, task: string): void {
  getGlobalEmitter().emit('activity:start', { worker, task })
}

export function emitActivityComplete(worker: string, result: string): void {
  getGlobalEmitter().emit('activity:complete', { worker, result })
}

export function emitActivityError(worker: string, error: string): void {
  getGlobalEmitter().emit('activity:error', { worker, error })
}

export function emitFinding(technique: string, severity: string, endpoint: string): void {
  getGlobalEmitter().emit('finding', { technique, severity, endpoint })
}

export function emitGraphUpdate(action: string, nodeType: string): void {
  getGlobalEmitter().emit('graph:update', { action, nodeType })
}

export function emitSpiderProgress(url: string, status: number): void {
  getGlobalEmitter().emit('spider:progress', { url, status })
}

export function emitRecorderInteraction(type: string, description: string): void {
  getGlobalEmitter().emit('recorder:interaction', { type, description })
}

export { TypedEventEmitter }
