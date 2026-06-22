import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { AgentManager } = await import('@/lib/agent-manager')
    const manager = AgentManager.getInstance()
    if (!manager.isInitialized()) {
      return Response.json({ findings: [] })
    }

    const findings = await manager.getFindings()
    const severity = req.nextUrl.searchParams.get('severity')
    const type = req.nextUrl.searchParams.get('type')

    let filtered = findings
    if (severity) filtered = filtered.filter(f => f.properties?.severity === severity)
    if (type) filtered = filtered.filter(f => f.properties?.technique === type)

    return Response.json({ findings: filtered })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
