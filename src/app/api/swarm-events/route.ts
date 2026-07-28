import { NextRequest } from 'next/server'
import { getGlobalEmitter, type EventMap } from '@/events/emitter'

type EventKey = keyof EventMap

// All event types we forward to the client
const FORWARD_EVENTS: EventKey[] = [
  // Solver
  'solver:start', 'solver:phase', 'solver:complete', 'solver:stale', 'solver:interrupt',
  // Tool
  'tool:call', 'tool:result', 'tool:error', 'tool:progress',
  // Worker
  'worker:spawned', 'worker:started', 'worker:tool-call', 'worker:tool-result',
  'worker:progress', 'worker:completed', 'worker:error', 'worker:timeout',
  'worker:killed', 'worker:context-budget',
  // Swarm
  'swarm:started', 'swarm:worker-dispatched', 'swarm:worker-completed',
  'swarm:completed', 'swarm:sequential-next', 'swarm:parallel-progress',
  // Intelligence
  'evidence:recorded', 'evidence:verified', 'evidence:rejected',
  'reflexion:escalation', 'reflexion:experience',
  'anti-loop:stale', 'anti-loop:dead-end',
  'hypothesis:generated', 'hypothesis:tested',
  // Graph
  'graph:node-added', 'graph:edge-added', 'graph:finding-added', 'graph:attack-added', 'graph:mutated',
  // Browser
  'browser:navigate', 'browser:reaction', 'browser:dialog', 'browser:auth-detected',
  'browser:bot-detected', 'browser:bot-resolved',
  // Finding
  'finding:discovered', 'finding:verified', 'finding:status-changed', 'finding:chain-detected',
  // Session
  'session:init', 'session:config', 'session:error', 'session:complete',
  // Spider
  'spider:start', 'spider:page', 'spider:endpoint', 'spider:complete', 'spider:error',
]

// Events that carry worker context
const WORKER_EVENTS = new Set<string>([
  'worker:spawned', 'worker:started', 'worker:tool-call', 'worker:tool-result',
  'worker:progress', 'worker:completed', 'worker:error', 'worker:timeout',
  'worker:killed', 'worker:context-budget',
  'swarm:worker-dispatched', 'swarm:worker-completed',
])

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()

  // Parse query params for filtering
  const url = new URL(req.url)
  const typeFilter = url.searchParams.get('types')?.split(',').map(s => s.trim()) ?? []
  const workerFilter = url.searchParams.get('workerId') ?? null

  const stream = new ReadableStream({
    start(controller) {
      let eventCount = 0
      const buffer: unknown[] = []
      let flushTimer: ReturnType<typeof setInterval> | null = null

      const sendEvents = (events: unknown[]) => {
        if (events.length === 0) return
        try {
          const payload = JSON.stringify({ events })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        } catch {
          // Stream closed
        }
      }

      const flush = () => {
        if (buffer.length > 0) {
          sendEvents(buffer.splice(0))
        }
      }

      // Flush buffer every 100ms for batching
      flushTimer = setInterval(flush, 100)

      // Send connection confirmation
      sendEvents([{ type: 'connected', timestamp: Date.now(), eventCount: 0 }])

      // Subscribe to the global event bus — one listener per event type
      const bus = getGlobalEmitter()
      const cleanupFns: Array<() => void> = []

      for (const eventType of FORWARD_EVENTS) {
        const listener = (payload: any) => {
          // Apply type filter
          if (typeFilter.length > 0) {
            const prefix = eventType.split(':')[0]
            if (!typeFilter.some(f => eventType.startsWith(f) || prefix === f)) return
          }

          // Apply worker filter
          if (workerFilter && typeof payload === 'object' && payload !== null) {
            const p = payload as Record<string, unknown>
            if (WORKER_EVENTS.has(eventType) && p.workerId !== workerFilter) return
            if (eventType.startsWith('tool:') && p.workerId && p.workerId !== workerFilter) return
          }

          eventCount++
          buffer.push({ ...payload, _event: eventType })
        }

        bus.on(eventType, listener)
        cleanupFns.push(() => bus.off(eventType, listener))
      }

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        sendEvents([{ type: 'heartbeat', timestamp: Date.now(), eventCount }])
      }, 30000)

      // Cleanup on disconnect
      req.signal.addEventListener('abort', () => {
        if (flushTimer) clearInterval(flushTimer)
        if (heartbeat) clearInterval(heartbeat)
        flush()
        for (const cleanup of cleanupFns) cleanup()
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
