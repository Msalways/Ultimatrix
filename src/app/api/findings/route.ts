import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'
import { loadPersistedGraph } from '@/web/persisted-graph'
import { NodeType } from '@/graph/schema'

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    const engine = target
      ? targetManager.getEngine(target)
      : (await targetManager.listTargets()).length > 0
        ? targetManager.getEngine((await targetManager.listTargets()).pop()!.target)
        : null

    if (!target && (!engine || !engine.isInitialized())) {
      return Response.json({ findings: [] })
    }

    const findings = engine?.isInitialized()
      ? engine.getFindings()
      : (await loadPersistedGraph(target!)).queryNodes(NodeType.FINDING)
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
