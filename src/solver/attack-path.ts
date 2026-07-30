import { NodeType } from '../graph/schema'
import type {EndpointNode, FindingNode} from '../graph/schema'
import type { GraphStore } from '../graph/store'
import { log } from '../utils/logger'

export interface AttackPath {
  id: string
  steps: Array<{
    endpointId: string
    url: string
    method: string
    findingType?: string
    severity?: string
  }>
  entryPoint: string
  targetAsset: string
  totalSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  chainLength: number
}

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'] as const

function severityIndex(s: string): number {
  const idx = SEVERITY_ORDER.indexOf(s as typeof SEVERITY_ORDER[number])
  return idx === -1 ? 0 : idx
}

function maxSeverity(a: string, b: string): string {
  return SEVERITY_ORDER[Math.max(severityIndex(a), severityIndex(b))]
}

/**
 * Find attack paths from unauthenticated endpoints to sensitive assets
 * by traversing CHAINS_TO, PRODUCES, and VALUE_ORIGIN edges in the graph.
 */
export function findAttackPaths(graphStore: GraphStore): AttackPath[] {
  const endpoints = graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const findings = graphStore.queryNodes(NodeType.FINDING) as FindingNode[]

  if (endpoints.length === 0) return []

  const adjList = new Map<string, Array<{ targetId: string; edgeType: string }>>()
  for (const ep of endpoints) {
    adjList.set(ep.id, [])
  }

  const edges = graphStore.getAllEdges?.() ?? []
  for (const edge of edges) {
    if (['CHAINS_TO', 'PRODUCES', 'EXPLOITS'].includes(edge.type)) {
      const existing = adjList.get(edge.fromId) ?? []
      existing.push({ targetId: edge.toId, edgeType: edge.type })
      adjList.set(edge.fromId, existing)
    }
  }

  const findingMap = new Map<string, FindingNode[]>()
  for (const f of findings) {
    const endpointUrl = f.properties.endpoint
    const matchingEp = endpoints.find(e => e.properties.url === endpointUrl)
    if (matchingEp) {
      const list = findingMap.get(matchingEp.id) ?? []
      list.push(f)
      findingMap.set(matchingEp.id, list)
    }
  }

  const sensitiveEndpoints = endpoints.filter(ep => {
    const epFindings = findingMap.get(ep.id) ?? []
    return epFindings.some(f =>
      f.properties.severity === 'critical' || f.properties.severity === 'high'
    )
  })

  if (sensitiveEndpoints.length === 0) return []

  const paths: AttackPath[] = []
  const visited = new Set<string>()

  for (const sensitive of sensitiveEndpoints) {
    const bfsQueue: Array<{ currentId: string; path: AttackPath['steps'] }> = []
    const seen = new Set<string>()

    for (const [startId] of adjList) {
      const startEp = endpoints.find(e => e.id === startId)
      if (!startEp) continue
      const authRequired = startEp.properties.authRequired || startEp.properties.authType
      if (authRequired) continue

      bfsQueue.push({
        currentId: startId,
        path: [{
          endpointId: startId,
          url: startEp.properties.url,
          method: startEp.properties.method,
        }],
      })
      seen.add(startId)
    }

    while (bfsQueue.length > 0) {
      const { currentId, path } = bfsQueue.shift()!

      if (currentId === sensitive.id) {
        const pathId = path.map(s => s.endpointId).join('->')
        if (!visited.has(pathId)) {
          visited.add(pathId)
          let severity = 'info'
          for (const step of path) {
            const stepFindings = findingMap.get(step.endpointId) ?? []
            for (const f of stepFindings) {
              severity = maxSeverity(severity, f.properties.severity)
              step.findingType = f.properties.technique
              step.severity = f.properties.severity
            }
          }
          paths.push({
            id: `attack-path-${paths.length + 1}`,
            steps: path,
            entryPoint: path[0].url,
            targetAsset: sensitive.properties.url,
            totalSeverity: severity as any,
            chainLength: path.length,
          })
        }
        continue
      }

      const neighbors = adjList.get(currentId) ?? []
      for (const { targetId } of neighbors) {
        if (!seen.has(targetId)) {
          seen.add(targetId)
          const targetEp = endpoints.find(e => e.id === targetId)
          if (targetEp) {
            bfsQueue.push({
              currentId: targetId,
              path: [...path, {
                endpointId: targetId,
                url: targetEp.properties.url,
                method: targetEp.properties.method,
              }],
            })
          }
        }
      }
    }
  }

  paths.sort((a, b) => {
    const sevDiff = severityIndex(b.totalSeverity) - severityIndex(a.totalSeverity)
    if (sevDiff !== 0) return sevDiff
    return a.chainLength - b.chainLength
  })

  if (paths.length > 0) {
    log.info(`Attack paths found: ${paths.length} (highest: ${paths[0].totalSeverity})`)
  }

  return paths
}
