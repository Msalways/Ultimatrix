/**
 * POST /api/solve — SSE endpoint for the Web UI chat.
 *
 * Fixes from error handling audit:
 * - C1: Abort signal forwarded to engine.solve() via AbortController
 * - C4: Client disconnect detection via req.signal.addEventListener('abort')
 * - A4: Proper error propagation and cleanup
 * - SSE: force-dynamic, X-Accel-Buffering: no for proxy compatibility
 *
 * F36: 50ms write batching + desiredSize backpressure check.
 * F37: Single terminal done event (solver's internal done filtered).
 * F42: Envelope {runId, seq, timestamp} on every SSE frame.
 */

import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { goal, target, solverConfig, interactionMode } = await req.json()

    if (!goal) {
      return new Response(JSON.stringify({ error: 'goal is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (!target) {
      return new Response(JSON.stringify({ error: 'target is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const engine = await targetManager.getOrCreateEngine(target)

    if (!engine) {
      return new Response(JSON.stringify({ error: 'No target configured. Create a session first.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!engine.isInitialized()) {
      await engine.init({ target: engine.target })
    }

    const encoder = new TextEncoder()
    let controllerClosed = false

    // F42: SSE frame envelope — every frame carries runId + monotonic seq + timestamp.
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let seq = 0

    // F36: Write batching — buffer frames for 50ms then flush.
    // Checks controller.desiredSize for backpressure (don't enqueue faster than
    // the network can drain).
    const flushBuffer: string[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let flushController: ReadableStreamDefaultController<Uint8Array> | null = null

    const flush = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      if (!flushController || flushBuffer.length === 0) return
      // Backpressure: skip batched writes when the buffer is full
      const canWrite = flushController.desiredSize === null || flushController.desiredSize > 0
      if (!canWrite) return
      const batch = flushBuffer.splice(0).join('')
      try {
        flushController.enqueue(encoder.encode(batch))
      } catch {
        controllerClosed = true
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        flushController = controller

        const send = (event: string, data: unknown) => {
          if (controllerClosed) return
          // F42: envelope every frame
          const frame = `event: ${event}\ndata: ${JSON.stringify({ runId, seq: seq++, ts: Date.now(), payload: data })}\n\n`
          flushBuffer.push(frame)
          // If buffer is large, flush immediately (avoid memory buildup)
          if (flushBuffer.length >= 20) {
            flush()
          } else if (!flushTimer) {
            flushTimer = setTimeout(flush, 50)
          }
        }

        const emitter = engine.getEvents()
        const listeners: Array<[string, (...args: any[]) => void]> = []
        const on = (event: string, handler: (...args: any[]) => void) => {
          emitter.on(event as any, handler)
          listeners.push([event, handler])
        }

        on('worker:spawned', (e) => send('worker:spawned', e))
        on('worker:completed', (e) => send('worker:completed', e))
        on('worker:tool-call', (e) => send('worker:tool', e))
        on('worker:error', (e) => send('worker:error', e))
        on('finding:discovered', (e) => send('finding:discovered', e))
        on('finding:verified', (e) => send('finding:verified', e))
        on('graph:node-added', (e) => send('graph:node', e))
        on('graph:edge-added', (e) => send('graph:edge', e))
        on('evidence:recorded', (e) => send('evidence:recorded', e))
        on('reflexion:escalation', (e) => send('reflexion:escalation', e))
        on('anti-loop:stale', (e) => send('anti-loop:stale', e))
        on('browser:reaction', (e) => send('browser:reaction', e))
        on('browser:starting', (e) => send('browser:starting', e))
        on('browser:ready', (e) => send('browser:ready', e))
        on('browser:failed', (e) => send('browser:failed', e))
        on('spider:progress', (e) => send('spider:progress', e))
        on('spider:event', (e) => send('spider:event', e))

        const heartbeat = setInterval(() => send('heartbeat', { timestamp: Date.now() }), 30_000)
        const cleanup = () => {
          clearInterval(heartbeat)
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
          for (const [event, handler] of listeners) emitter.off(event as any, handler)
          // Final flush
          flush()
        }
        const close = () => {
          if (controllerClosed) return
          controllerClosed = true
          flush()
          try { controller.close() } catch {}
        }

        req.signal.addEventListener('abort', () => {
          engine.abort()
          cleanup()
          close()
        }, { once: true })

        try {
          send('started', { target: engine.target, goal, timestamp: Date.now() })
          const result = await engine.solve({
            goal,
            interactionMode: interactionMode === 'run' ? 'run' : undefined,
            solverConfig,
            // F37 FIX: Skip forwarding the solver's internal "done" message —
            // the route sends its own canonical "done" event with the full result.
            onMessage: (msg) => { if (msg.kind !== 'done') send('solver', msg) },
            onPhase: (event) => send('phase', event),
          })
          send('done', result)
        } catch (err) {
          send('error', { message: err instanceof Error ? err.message : String(err) })
        } finally {
          cleanup()
          close()
        }
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
