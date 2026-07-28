import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'
import { getGlobalEmitter } from '@/events/emitter'

export async function POST(req: NextRequest) {
  try {
    const { goal, target, solverConfig } = await req.json()

    if (!goal) {
      return new Response(JSON.stringify({ error: 'goal is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const engine = target
      ? await targetManager.getOrCreateEngine(target)
      : (await targetManager.listTargets()).length > 0
        ? targetManager.getEngine((await targetManager.listTargets()).pop()!.target)
        : null

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
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          } catch {
            // Controller closed
          }
        }

        const emitter = getGlobalEmitter()
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
        on('spider:progress', (e) => send('spider:progress', e))

        // Heartbeat
        const heartbeat = setInterval(() => {
          send('heartbeat', { timestamp: Date.now() })
        }, 30_000)

        try {
          send('started', { target: engine.target, goal, timestamp: Date.now() })

          const result = await engine.solve({
            goal,
            solverConfig,
            onMessage: (msg) => send('solver', msg),
            onPhase: (event) => send('phase', event),
          })

          send('done', result)
        } catch (err) {
          send('error', { message: String(err) })
        } finally {
          clearInterval(heartbeat)
          for (const [event, handler] of listeners) {
            emitter.off(event as any, handler)
          }
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
