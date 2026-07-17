import { EdgeType, NodeType, type EndpointNode } from './schema'
import type { GraphStore } from './store'
import { looksLikeId } from '../research/utils'

/**
 * Single owner of relation-building logic for the business-logic graph.
 *
 * Relations are computed from data shape (URL structure, value reuse), never
 * from keyword/enum detection. The LLM later queries these relations to propose
 * scenarios — this module only *builds* them.
 */

/**
 * Normalized endpoint key: METHOD + origin + pathname, with id-shaped path
 * segments collapsed to `:id` so two requests to the same resource shape with
 * different identifiers resolve to one logical endpoint. Shape-based only.
 */
export function normalizedEndpointKey(method: string, url: string): string {
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').filter(Boolean).map(s =>
      looksLikeId(s) ? ':id' : s,
    )
    return `${method.toUpperCase()}:${u.origin}/${segments.join('/')}`
  } catch {
    return `${method.toUpperCase()}:${url}`
  }
}

/**
 * Build cross-API reingest edges: when a value produced by one endpoint's
 * response (or a UI input) is later sent in a *different* endpoint's request,
 * link source-endpoint -> sink-endpoint via REINGESTS. Same-endpoint reuse is
 * skipped (not a trust boundary).
 *
 * `origins` carries { sourceEndpointUrl?, sinkMethod, sinkUrl, sourceKind }.
 */
export function buildReingestEdges(
  store: GraphStore,
  origins: Array<{
    sourceEndpointUrl?: string
    sourceKind: string
    sinkMethod: string
    sinkUrl: string
    valueSample: string
  }>,
): number {
  const endpoints = store.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const byKey = new Map<string, string>()
  const byUrl = new Map<string, string>()
  for (const ep of endpoints) {
    byKey.set(normalizedEndpointKey(ep.properties.method, ep.properties.url), ep.id)
    byUrl.set(ep.properties.url, ep.id)
  }

  let created = 0
  const seen = new Set<string>()
  for (const o of origins) {
    const sinkId = byKey.get(normalizedEndpointKey(o.sinkMethod, o.sinkUrl)) ?? byUrl.get(o.sinkUrl)
    if (!sinkId) continue
    if (!o.sourceEndpointUrl) continue // UI-input sources handled by VALUE_ORIGIN already
    const srcId = byKey.get(normalizedEndpointKey('GET', o.sourceEndpointUrl))
      ?? byUrl.get(o.sourceEndpointUrl)
    if (!srcId || srcId === sinkId) continue

    const key = `${srcId}->${sinkId}`
    if (seen.has(key)) continue
    seen.add(key)
    store.addEdge({
      fromId: srcId,
      toId: sinkId,
      type: EdgeType.REINGESTS,
      properties: { sourceKind: o.sourceKind, valueSample: o.valueSample },
    })
    created++
  }
  return created
}

/**
 * Build ordering edges between endpoints in a known sequence (e.g. a workflow's
 * step order, or human-observer action order). Consecutive pairs get
 * ORDERED_BEFORE. No keyword logic — the order is supplied by the caller.
 */
export function buildOrderingEdges(
  store: GraphStore,
  orderedEndpointIds: string[],
): number {
  let created = 0
  for (let i = 0; i < orderedEndpointIds.length - 1; i++) {
    const fromId = orderedEndpointIds[i]
    const toId = orderedEndpointIds[i + 1]
    if (fromId === toId) continue
    store.addEdge({
      fromId,
      toId,
      type: EdgeType.ORDERED_BEFORE,
      properties: { order: i },
    })
    created++
  }
  return created
}
