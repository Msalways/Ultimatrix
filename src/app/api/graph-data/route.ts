import { NextRequest, NextResponse } from 'next/server'
import { targetManager } from '@/web/target-manager'
import { loadPersistedGraph } from '@/web/persisted-graph'
import { NodeType } from '@/graph/schema'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    const engine = target
      ? targetManager.getEngine(target)
      : (await targetManager.listTargets()).length > 0
        ? targetManager.getEngine((await targetManager.listTargets()).pop()!.target)
        : null

    if (!target && (!engine || !engine.isInitialized())) {
      return NextResponse.json({ nodes: [], edges: [], findings: [] })
    }

    const store = engine?.isInitialized() ? engine.getGraph() : await loadPersistedGraph(target!)
    const nodes = store.queryNodes(undefined)
    const edges = store.getAllEdges()
    const findings = engine?.isInitialized()
      ? engine.getFindings()
      : nodes.filter((n: any) => n.type === NodeType.FINDING)

    const graphNodes = nodes.map((n: any) => ({
      id: n.id,
      type: n.type,
      label: n.properties?.label ?? n.properties?.title ?? n.properties?.url ?? n.properties?.description ?? n.id,
      properties: n.properties,
    }))

    const graphEdges = edges.map((e: any) => ({
      source: e.fromId,
      target: e.toId,
      type: e.type,
    }))

    const severity = req.nextUrl.searchParams.get('severity')
    const type = req.nextUrl.searchParams.get('type')
    let filteredFindings = findings
    if (severity) filteredFindings = filteredFindings.filter((f: any) => f.properties?.severity === severity)
    if (type) filteredFindings = filteredFindings.filter((f: any) => f.properties?.technique === type)

    return NextResponse.json({ nodes: graphNodes, edges: graphEdges, findings: filteredFindings })
  } catch (err) {
    return NextResponse.json(
      { nodes: [], edges: [], findings: [], error: (err as Error).message },
      { status: 500 },
    )
  }
}
