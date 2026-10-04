import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

export type OperatorInteractionKind = 'question' | 'browser-handoff' | 'approval'

export interface OperatorInteractionRequest {
  runId: string
  requestId: string
  kind: OperatorInteractionKind
  question: string
  options?: string[]
  context?: Record<string, unknown>
}

interface PendingRequest {
  runId: string
  resolve: (answer: string) => void
  request: OperatorInteractionRequest
  timeoutMs: number
  timer?: ReturnType<typeof setTimeout>
}

/** Per-engagement rendezvous between a running solver and its operator surface. */
export class InteractionBroker extends EventEmitter {
  private activeRunId?: string
  private pending = new Map<string, PendingRequest>()
  private requestQueue: string[] = []
  private activeRequestId?: string
  private steering = new Map<string, string[]>()
  private steeringCount = new Map<string, number>()

  beginRun(runId: string): void {
    this.endRun()
    this.activeRunId = runId
    this.steering.set(runId, [])
    this.steeringCount.set(runId, 0)
    this.emit('run', { runId, status: 'started' })
  }

  endRun(runId = this.activeRunId): void {
    if (!runId) return
    for (const [requestId, pending] of this.pending) {
      if (pending.runId !== runId) continue
      if (pending.timer) clearTimeout(pending.timer)
      this.pending.delete(requestId)
      pending.resolve('')
    }
    this.requestQueue = this.requestQueue.filter(requestId => this.pending.has(requestId))
    if (this.activeRequestId && !this.pending.has(this.activeRequestId)) this.activeRequestId = undefined
    if (this.activeRunId === runId) this.activeRunId = undefined
    this.steering.delete(runId)
    this.steeringCount.delete(runId)
    this.emit('run', { runId, status: 'ended' })
  }

  request(input: Omit<OperatorInteractionRequest, 'runId' | 'requestId'>, timeoutMs = 300_000): Promise<string> {
    const runId = this.activeRunId
    if (!runId) return Promise.resolve('')
    const requestId = randomUUID()
    const request: OperatorInteractionRequest = { ...input, runId, requestId }
    return new Promise(resolve => {
      this.pending.set(requestId, { runId, resolve, request, timeoutMs })
      this.requestQueue.push(requestId)
      this.dispatchNext()
    })
  }

  reply(runId: string, requestId: string, answer: string): boolean {
    const pending = this.pending.get(requestId)
    if (!pending || pending.runId !== runId || this.activeRunId !== runId || this.activeRequestId !== requestId) return false
    if (pending.timer) clearTimeout(pending.timer)
    this.pending.delete(requestId)
    this.activeRequestId = undefined
    pending.resolve(answer)
    this.dispatchNext()
    return true
  }

  isPending(runId: string, requestId: string): boolean {
    return this.activeRunId === runId && this.activeRequestId === requestId && this.pending.get(requestId)?.runId === runId
  }

  isActive(): boolean {
    return this.activeRunId !== undefined
  }

  steer(runId: string, message: string): boolean {
    if (this.activeRunId !== runId || !message.trim()) return false
    const queue = this.steering.get(runId) ?? []
    const count = this.steeringCount.get(runId) ?? 0
    if (count >= 5) return false
    queue.push(message.trim())
    this.steeringCount.set(runId, count + 1)
    this.steering.set(runId, queue)
    this.emit('steer', { runId, message: message.trim() })
    return true
  }

  takeSteering(runId: string): string[] {
    if (this.activeRunId !== runId) return []
    const messages = this.steering.get(runId) ?? []
    this.steering.set(runId, [])
    return messages
  }

  private dispatchNext(): void {
    if (this.activeRequestId) return
    while (this.requestQueue.length > 0) {
      const requestId = this.requestQueue.shift()!
      const pending = this.pending.get(requestId)
      if (!pending || this.activeRunId !== pending.runId) continue
      this.activeRequestId = requestId
      pending.timer = setTimeout(() => {
        this.pending.delete(requestId)
        this.activeRequestId = undefined
        pending.resolve('')
        this.dispatchNext()
      }, pending.timeoutMs)
      this.emit('request', pending.request)
      return
    }
  }
}
