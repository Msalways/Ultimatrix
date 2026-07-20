import { getGlobalGraphStore } from '../graph/store'
import { NodeType, EdgeType, type ThreatModelNode } from '../graph/schema'
import { isUrlInScope } from '../safety/scope-guard'

export interface ThreatModelProposal {
  node?: ThreatModelNode
  skipped?: string
}

/**
 * W0.5 — build a typed THREAT_MODEL node for a confirmed finding.
 *
 * No frozen vocabulary: the assets at risk and the next in-scope pivot target
 * are derived from the live graph (endpoints REACHED by the held session via
 * SESSION_REACHES edges, plus the finding's own endpoint), never from a
 * hardcoded list. The trust boundary is taken from the finding's technique/
 * evidence field when present, otherwise left for the caller (brain) to fill.
 *
 * Scope-guarded: only in-scope endpoints become next-target candidates.
 */
export function proposeThreatModel(
  findingId: string,
  opts?: { store?: ReturnType<typeof getGlobalGraphStore> },
): ThreatModelProposal {
  const store = opts?.store ?? getGlobalGraphStore()
  const findings = (store.queryNodes(NodeType.FINDING as any) as any[]) ?? []
  const finding = findings.find((f: any) => f.properties?.findingId === findingId)
  if (!finding) {
    return { skipped: `finding ${findingId} not found` }
  }

  const edges = store.queryEdges
    ? store.queryEdges({ type: EdgeType.SESSION_REACHES as any } as any)
    : []

  const reachable: string[] = []
  for (const e of Array.isArray(edges) ? edges : []) {
    const to = (e as any).toId ?? (e as any).to
    const props = (e as any).properties ?? {}
    if (props?.fromFindingId === findingId && typeof to === 'string') {
      if (isUrlInScope(to)) reachable.push(to)
    }
  }

  const ownEndpoint = finding.properties?.endpoint
  if (typeof ownEndpoint === 'string' && isUrlInScope(ownEndpoint)) {
    reachable.push(ownEndpoint)
  }

  const assetsAtRisk = Array.from(new Set(reachable)).slice(0, 12)
  const nextTarget = assetsAtRisk.find((u) => u !== ownEndpoint)

  const node = store.addThreatModel({
    findingId,
    assetsAtRisk,
    trustBoundary:
      (finding.properties?.technique as string) ||
      (finding.properties?.evidence as string) ||
      '',
    nextTarget,
    businessImpact: finding.properties?.impact as string | undefined,
  })

  return { node }
}

/** All threat-model nodes currently in the graph. */
export function listThreatModels(
  opts?: { store?: ReturnType<typeof getGlobalGraphStore> },
): ThreatModelNode[] {
  const store = opts?.store ?? getGlobalGraphStore()
  return ((store.queryNodes(NodeType.THREAT_MODEL as any) as any[]) ?? []) as ThreatModelNode[]
}
