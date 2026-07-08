import { NodeType, type EndpointNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { ResearchEntity } from './types'
import { inferNameFromUrl, looksLikeId, normalizeName, stableId, uniq, words } from './utils'
import { getTechniqueRegistry } from '../skills/technique-registry'

function entityFromEndpoint(url: string): { name: string; ids: string[] } {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const ids = segments.filter(looksLikeId)
    const candidate = segments.findLast(s => !looksLikeId(s) && !['api', 'v1', 'v2', 'v3'].includes(s.toLowerCase()))
    return { name: normalizeName(candidate || inferNameFromUrl(url)), ids }
  } catch {
    return { name: normalizeName(inferNameFromUrl(url)), ids: [] }
  }
}

export function extractEntities(store: GraphStore): ResearchEntity[] {
  const endpoints = store.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const entities = new Map<string, ResearchEntity>()
  const entityFields = getTechniqueRegistry().getEntityFields()

  for (const endpoint of endpoints) {
    const props = endpoint.properties
    const derived = entityFromEndpoint(props.url)
    const paramNames = (props.params || []).map(p => p.name)
    const bodyKeys = props.bodySchema ? Object.keys(props.bodySchema) : []
    const allFields = uniq([...paramNames, ...bodyKeys])
    const lowerFields = allFields.map(f => f.toLowerCase())
    const urlWords = words(props.url)

    const ownerFields = allFields.filter(f => entityFields.owner.some(o => f.toLowerCase().includes(o.toLowerCase())))
    const roleFields = allFields.filter(f => entityFields.role.some(r => f.toLowerCase().includes(r.toLowerCase())))
    const sensitiveFields = allFields.filter(f => entityFields.sensitive.some(s => f.toLowerCase().includes(s.toLowerCase())))
    const lifecycleStates = entityFields.states.filter(s => lowerFields.includes(s) || urlWords.includes(s))

    const id = stableId('entity', [derived.name])
    const existing = entities.get(id)
    entities.set(id, {
      id,
      name: derived.name,
      ids: uniq([...(existing?.ids || []), ...derived.ids]),
      endpoints: uniq([...(existing?.endpoints || []), endpoint.id]),
      ownerFields: uniq([...(existing?.ownerFields || []), ...ownerFields]),
      roleFields: uniq([...(existing?.roleFields || []), ...roleFields]),
      sensitiveFields: uniq([...(existing?.sensitiveFields || []), ...sensitiveFields]),
      lifecycleStates: uniq([...(existing?.lifecycleStates || []), ...lifecycleStates]),
      confidence: Math.min(0.95, (existing?.confidence || 0.45) + 0.08),
    })
  }

  return [...entities.values()].sort((a, b) => b.confidence - a.confidence)
}
