import { NextRequest } from 'next/server'
import { toAISdkV5Stream } from '@mastra/ai-sdk'
import { AgentManager } from '@/lib/agent-manager'
import { loadConfig } from '@/config'

export async function POST(req: NextRequest) {
  try {
    const { messages, threadId } = await req.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json({ ok: false, code: 'INVALID_MESSAGES', error: 'messages array is required' }, { status: 400 })
    }

    const manager = AgentManager.getInstance()
    if (!manager.isInitialized()) {
      try {
        const config = loadConfig()
        await manager.init(config)
      } catch (e) {
        return Response.json({
          ok: false,
          code: 'INIT_FAILED',
          error: `Agent init failed: ${e instanceof Error ? e.message : String(e)}`,
          initErrors: manager.getInitErrors(),
        }, { status: 500 })
      }
    }

    let result: any
    try {
      result = await manager.chat(messages, threadId)
    } catch (e) {
      return Response.json({
        ok: false,
        code: 'STREAM_FAILED',
        error: `Agent stream failed: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 500 })
    }

    const stream = toAISdkV5Stream(result, { from: 'agent' })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, code: 'UNKNOWN', error: message }, { status: 500 })
  }
}
