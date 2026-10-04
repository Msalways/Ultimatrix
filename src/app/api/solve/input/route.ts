import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const input = await req.json() as {
      target?: string
      runId?: string
      requestId?: string
      kind?: 'reply' | 'steer'
      message?: string
    }
    if (!input.target || !input.runId || !input.kind || typeof input.message !== 'string') {
      return Response.json({ error: 'target, runId, kind and message are required' }, { status: 400 })
    }
    if (input.message.length > 10_000) {
      return Response.json({ error: 'message exceeds 10000 characters' }, { status: 413 })
    }
    const engine = targetManager.getEngine(input.target)
    if (!engine?.isRunning()) return Response.json({ error: 'No active run for target' }, { status: 404 })

    const accepted = input.kind === 'steer'
      ? engine.submitOperatorDirection(input.runId, input.message)
      : input.requestId
        ? engine.submitOperatorReply(input.runId, input.requestId, input.message)
        : false
    if (!accepted) return Response.json({ error: 'Interaction is no longer pending for this run' }, { status: 409 })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid request' }, { status: 400 })
  }
}
