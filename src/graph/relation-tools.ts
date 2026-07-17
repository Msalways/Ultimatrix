import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from './store'
import { NodeType, EdgeType } from './schema'

/**
 * Live schema-discovery. The LLM queries this to learn the valid node/edge
 * vocabulary at runtime instead of relying on any frozen list in a tool
 * description. No hardcoded enumeration — the vocabulary is reflected from the
 * registry that is the single source of truth.
 */
export const getGraphSchema = createTool({
  id: 'getGraphSchema',
  description:
    'Discover the live vocabulary of the knowledge graph: the node types, edge types, and the relation ' +
    'kinds that tools can query or follow. Call this FIRST whenever you need to filter by type, follow ' +
    'edges, or ask a relational question — the values returned here are the only valid values. ' +
    'This replaces any assumed or memorized type list.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      const nodeTypes = Object.values(NodeType)
      const edgeTypes = Object.values(EdgeType)
      // Relation kinds are the edge types plus the derived cross-API shapes the
      // analyser writes (provenance / reingest / ordering). They are surfaced
      // from the graph itself rather than a frozen string.
      const presentEdgeTypes = new Set(edgeTypes)
      for (const e of store.queryEdges()) presentEdgeTypes.add(e.type)
      return {
        ok: true,
        value: {
          nodeTypes,
          edgeTypes: Array.from(presentEdgeTypes),
          note: 'Filter by `type` using these exact values. Do not invent or assume types.',
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

/**
 * Structural capture overview — the "network-tab shape" intuition a human
 * hunter has, computed from the graph and never a truncated prose summary.
 * Descriptions here are type-agnostic: the LLM learns valid types via
 * getGraphSchema and asks about whatever it infers.
 */
export const getCaptureOverview = createTool({
  id: 'getCaptureOverview',
  description:
    'Return structural metadata about the captured traffic and graph — counts, methods, status ' +
    'distributions, which endpoints emit which response-field names, and how values flow between ' +
    'endpoints (provenance / reingestion). This is COMPLETE metadata with no response bodies and no ' +
    'truncation: it lets you perceive the full capture shape before drilling into specific nodes via ' +
    'queryGraph. Discover valid node/edge/relation vocabulary via getGraphSchema first.',
  inputSchema: z.object({
    maxEndpoints: z.number().optional().default(0).describe('Cap endpoint detail blocks. 0 = include all.'),
  }),
  execute: async ({ maxEndpoints }) => {
    try {
      const store = getGlobalGraphStore()
      const endpoints = store.queryNodes(NodeType.ENDPOINT) as Array<{ properties: Record<string, unknown>; id: string }>
      const edges = store.queryEdges()

      const methodCounts: Record<string, number> = {}
      const originCounts: Record<string, number> = { target: 0, self: 0 }
      const endpointSummaries = endpoints.map((ep) => {
        const p = ep.properties
        const method = String(p.method ?? 'UNKNOWN')
        methodCounts[method] = (methodCounts[method] ?? 0) + 1
        const origin = String(p.origin ?? 'target')
        if (origin === 'self') originCounts.self += 1
        else originCounts.target += 1
        const outgoing = edges.filter((e) => e.fromId === ep.id)
        const incoming = edges.filter((e) => e.toId === ep.id)
        return {
          id: ep.id,
          method,
          url: String(p.url ?? ''),
          origin,
          paramNames: Array.isArray(p.params) ? (p.params as Array<{ name: string }>).map((x) => x.name) : [],
          outgoingEdgeTypes: outgoing.map((e) => e.type),
          incomingEdgeTypes: incoming.map((e) => e.type),
        }
      })

      const edgeTypeCounts: Record<string, number> = {}
      for (const e of edges) edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] ?? 0) + 1

      const limited = maxEndpoints && maxEndpoints > 0 ? endpointSummaries.slice(0, maxEndpoints) : endpointSummaries

      return {
        ok: true,
        value: {
          endpointCount: endpoints.length,
          methodCounts,
          originCounts,
          edgeTypeCounts,
          endpoints: limited,
          truncated: !!maxEndpoints && maxEndpoints > 0 && endpointSummaries.length > maxEndpoints,
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

/**
 * Relational query seam — the make-or-break interface for business-logic
 * hunting. The LLM asks a STRUCTURAL question (by relation type, node type,
 * or a value to trace); the tool returns the precise subgraph + candidate
 * mutation seeds. It returns EVIDENCE, never a verdict: the LLM decides what
 * scenario exists and whether it is exploitable. No frozen scenario enum — the
 * LLM is free to interrogate any relation/shape it infers from getGraphSchema.
 */
export const queryRelations = createTool({
  id: 'queryRelations',
  description:
    'Query the captured-traffic knowledge graph by RELATION, not by name-matching. Returns the ' +
    'matching edges plus the connected endpoint subgraph and — for cross-API value reuse — candidate ' +
    'mutation seeds (which value-shaped field of endpoint A later appears in endpoint B). Use this to ' +
    'surface trust-boundary / cross-API / workflow-order scenarios. The tool answers over the live ' +
    'graph; you (the LLM) decide exploitability and approach. Discover valid relation (edge) types and ' +
    'node types via getGraphSchema first. Filter by relation `type`, focus node `type`, or trace a ' +
    'specific `value`.',
  inputSchema: z.object({
    relationType: z.nativeEnum(EdgeType).optional().describe('Edge/relation type to follow. Discover valid values via getGraphSchema — do not assume a fixed list.'),
    nodeType: z.nativeEnum(NodeType).optional().describe('If set, only return edges touching a node of this type. Discover valid values via getGraphSchema.'),
    value: z.string().optional().describe('Trace a value: return edges where this value is the provenance source or sink (substring match on the recorded value sample).'),
    limit: z.number().optional().default(100).describe('Max edges to return. 0 = unbounded.'),
  }),
  execute: async ({ relationType, nodeType, value, limit }) => {
    try {
      const store = getGlobalGraphStore()
      let edges = store.queryEdges(relationType ? { type: relationType } : undefined)

      if (nodeType) {
        const nodeIds = new Set((store.queryNodes(nodeType) as Array<{ id: string }>).map((n) => n.id))
        edges = edges.filter((e) => nodeIds.has(e.fromId) || nodeIds.has(e.toId))
      }
      if (value) {
        edges = edges.filter((e) =>
          String(e.properties?.valueSample ?? '').includes(value) ||
          String(e.properties?.kind ?? '').includes(value),
        )
      }

      const cap = limit && limit > 0 ? limit : edges.length
      const sliced = edges.slice(0, cap)

      const nodeIds = new Set<string>()
      for (const e of sliced) {
        nodeIds.add(e.fromId)
        nodeIds.add(e.toId)
      }
      const nodeMap = new Map<string, any>()
      for (const id of nodeIds) {
        const n = store.getNode(id)
        if (n) nodeMap.set(id, n)
      }

      const summarize = (id: string) => {
        const n = nodeMap.get(id)
        if (!n) return { id, missing: true }
        const p = n.properties ?? {}
        return {
          id,
          type: n.type,
          url: p.url ?? p.endpoint ?? undefined,
          method: p.method ?? undefined,
          name: p.name ?? p.title ?? undefined,
          origin: p.origin ?? undefined,
        }
      }

      // Candidate mutation seeds: for REINGESTS edges, the cross-API reuse is a
      // backend-trust-boundary signal the LLM can probe. Derived structurally.
      const seeds = sliced
        .filter((e) => e.type === EdgeType.REINGESTS)
        .map((e) => ({
          relation: 'reingest',
          from: summarize(e.fromId),
          to: summarize(e.toId),
          sourceKind: String(e.properties?.sourceKind ?? ''),
          valueSample: String(e.properties?.valueSample ?? '').slice(0, 64),
        }))

      return {
        ok: true,
        value: {
          edgeCount: sliced.length,
          edges: sliced.map((e) => ({
            id: e.id,
            type: e.type,
            from: summarize(e.fromId),
            to: summarize(e.toId),
            properties: e.properties,
          })),
          reingestSeeds: seeds,
          truncated: !!limit && limit > 0 && edges.length > limit,
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
