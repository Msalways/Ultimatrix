import { NextRequest } from 'next/server'

export async function GET() {
  try {
    const { AgentManager } = await import('@/lib/agent-manager')
    const manager = AgentManager.getInstance()
    if (!manager.isInitialized()) {
      return Response.json({ code: [] })
    }

    const code = await manager.getCode()
    return Response.json({ code })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
