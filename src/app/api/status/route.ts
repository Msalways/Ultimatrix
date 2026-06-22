import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest) {
  try {
    const { AgentManager } = await import('@/lib/agent-manager')
    const manager = AgentManager.getInstance()
    const initialized = manager.isInitialized()

    const browserReady = initialized ? manager.getBrowser() !== null : false
    const oastPort = initialized ? manager.getOastPort() : null

    const initErrors = manager.getInitErrors()

    return Response.json({
      ok: true,
      initialized,
      browserReady,
      oastPort,
      initError: initErrors.length > 0 ? initErrors.join('; ') : null,
      uptime: process.uptime(),
      deployed: process.env.DEPLOYED === 'true',
      model: initialized ? manager.getConfig().model : null,
      target: initialized ? manager.getConfig().target : null,
      findings: initialized ? (await manager.getFindings()).length : 0,
      phase: initialized ? (browserReady ? 'ready' : 'starting') : 'off',
    })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
