import { NextRequest, NextResponse } from 'next/server'
import { targetManager } from '@/web/target-manager'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    const engine = target
      ? targetManager.getEngine(target)
      : (await targetManager.listTargets()).length > 0
        ? targetManager.getEngine((await targetManager.listTargets()).pop()!.target)
        : null

    if (!engine || !engine.isInitialized()) {
      return NextResponse.json({ nodes: [], edges: [] })
    }

    const store = engine.getGraph()
    const nodes = store.queryNodes(undefined)
    const edges = store.getAllEdges()

    const graphNodes = nodes.map((n: any) => ({
      id: n.id,
      type: n.type,
      label: n.properties?.label ?? n.properties?.title ?? n.properties?.url ?? n.properties?.description ?? n.id,
    }))

    const graphEdges = edges.map((e: any) => ({
      source: e.fromId,
      target: e.toId,
      type: e.type,
    }))

    return NextResponse.json({ nodes: graphNodes, edges: graphEdges })
  } catch (err) {
    return NextResponse.json(
      { nodes: [], edges: [], error: (err as Error).message },
      { status: 500 },
    )
  }
}
