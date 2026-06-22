import { NextRequest } from 'next/server'
import { getToolEventEmitter } from '@/lib/tool-events'

export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* stream closed */ }
      }

      // Subscribe to real tool events
      const emitter = getToolEventEmitter()

      const onEvent = (event: any) => {
        sendEvent(event)
      }
      emitter.on('event', onEvent)

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        sendEvent({ type: 'heartbeat' })
      }, 30000)

      // Send initial connected event
      sendEvent({ type: 'info', message: 'Activity stream connected', timestamp: Date.now() })

      // Cleanup on cancel
      _req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        emitter.off('event', onEvent)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
