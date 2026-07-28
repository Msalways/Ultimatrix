import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    const engine = target
      ? targetManager.getEngine(target)
      : (await targetManager.listTargets()).length > 0
        ? targetManager.getEngine((await targetManager.listTargets()).pop()!.target)
        : null

    if (!engine || !engine.isInitialized()) {
      return Response.json({ findings: [] })
    }

    const findings = engine.getFindings()
    const severity = req.nextUrl.searchParams.get('severity')
    const type = req.nextUrl.searchParams.get('type')

    let filtered = findings
    if (severity) filtered = filtered.filter((f: any) => f.properties?.severity === severity)
    if (type) filtered = filtered.filter((f: any) => f.properties?.technique === type)

    return Response.json({ findings: filtered })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
