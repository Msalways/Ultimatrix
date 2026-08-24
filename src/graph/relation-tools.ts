import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from './store'
import { NodeType, EdgeType } from './schema'
import type { GraphEdgeData, GraphNodeData } from './schema'

type GraphLike = ReturnType<typeof getGlobalGraphStore>

function summarizeNode(store: GraphLike, id: string) {
  const n = store.getNode(id) as GraphNodeData | undefined
  if (!n) return { id, missing: true }
  const p = n.properties ?? {}
  return {
    id,
    type: n.type,
    label: n.label,
    url: p.url ?? p.endpoint ?? undefined,
    method: p.method ?? undefined,
    name: p.name ?? p.title ?? p.roleName ?? undefined,
    origin: p.origin ?? undefined,
  }
}

function edgeMatches(
  edge: GraphEdgeData,
  nodeId: string,
  direction: 'in' | 'out' | 'both',
  edgeTypes?: EdgeType[],
): boolean {
  if (edgeTypes?.length && !edgeTypes.includes(edge.type)) return false
  if (direction === 'in') return edge.toId === nodeId
  if (direction === 'out') return edge.fromId === nodeId
  return edge.fromId === nodeId || edge.toId === nodeId
}

function buildNeighborhood(
  store: GraphLike,
  nodeId: string,
  opts: {
    depth: number
    direction: 'in' | 'out' | 'both'
    edgeTypes?: EdgeType[]
    maxEdges: number
  },
) {
  const visited = new Set<string>([nodeId])
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }]
  const edges: GraphEdgeData[] = []
  const seenEdges = new Set<string>()
  const allEdges = store.queryEdges() as GraphEdgeData[]

  while (queue.length && edges.length < opts.maxEdges) {
    const current = queue.shift()!
    if (current.depth >= opts.depth) continue
    for (const edge of allEdges) {
      if (!edgeMatches(edge, current.id, opts.direction, opts.edgeTypes)) continue
      if (!seenEdges.has(edge.id)) {
        edges.push(edge)
        seenEdges.add(edge.id)
        if (edges.length >= opts.maxEdges) break
      }
      const nextIds = opts.direction === 'in'
        ? [edge.fromId]
        : opts.direction === 'out'
          ? [edge.toId]
          : [edge.fromId, edge.toId]
      for (const nextId of nextIds) {
        if (!visited.has(nextId)) {
          visited.add(nextId)
          queue.push({ id: nextId, depth: current.depth + 1 })
        }
      }
    }
  }

  return {
    focus: summarizeNode(store, nodeId),
    nodes: Array.from(visited).map((id) => summarizeNode(store, id)),
    edges: edges.map((edge) => ({
      id: edge.id,
      type: edge.type,
      from: summarizeNode(store, edge.fromId),
      to: summarizeNode(store, edge.toId),
      properties: edge.properties,
    })),
    truncated: edges.length >= opts.maxEdges,
  }
}

function findEndpointNode(store: GraphLike, nodeId?: string, endpointUrl?: string): GraphNodeData | undefined {
  if (nodeId) return store.getNode(nodeId) as GraphNodeData | undefined
  if (!endpointUrl) return undefined
  const exact = store.queryNodes(NodeType.ENDPOINT, { url: endpointUrl }) as GraphNodeData[]
  if (exact[0]) return exact[0]
  return (store.queryNodes(NodeType.ENDPOINT) as GraphNodeData[])
    .find((node) => String(node.properties?.url ?? '').includes(endpointUrl))
}

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

export const getGraphNeighborhood = createTool({
  id: 'getGraphNeighborhood',
  description:
    'Load the parent/child graph neighborhood around one node. Returns connected nodes and edges by depth, ' +
    'direction, and optional edge types so the assistant can reason from graph memory instead of guessing.',
  inputSchema: z.object({
    nodeId: z.string(),
    depth: z.number().int().min(1).max(4).optional().default(2),
    direction: z.enum(['in', 'out', 'both']).optional().default('both'),
    edgeTypes: z.array(z.nativeEnum(EdgeType)).optional(),
    maxEdges: z.number().int().positive().max(500).optional().default(100),
  }),
  execute: async ({ nodeId, depth, direction, edgeTypes, maxEdges }) => {
    try {
      const store = getGlobalGraphStore()
      if (!store.getNode(nodeId)) return { ok: false, error: `Node not found: ${nodeId}` }
      return { ok: true, value: buildNeighborhood(store, nodeId, { depth, direction, edgeTypes, maxEdges }) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getWorkflowAround = createTool({
  id: 'getWorkflowAround',
  description:
    'Load workflow context around an endpoint or node: ordered edges, value-flow edges, reachability, and a small neighborhood. ' +
    'Use this before discussing app workarounds or bypass paths.',
  inputSchema: z.object({
    nodeId: z.string().optional(),
    endpointUrl: z.string().optional(),
    depth: z.number().int().min(1).max(3).optional().default(2),
  }).refine((v) => !!v.nodeId || !!v.endpointUrl, { message: 'nodeId or endpointUrl is required' }),
  execute: async ({ nodeId, endpointUrl, depth }) => {
    try {
      const store = getGlobalGraphStore()
      const focus = findEndpointNode(store, nodeId, endpointUrl)
      if (!focus) return { ok: false, error: 'Focus node not found' }
      const workflowEdgeTypes: EdgeType[] = [
        EdgeType.ORDERED_BEFORE,
        EdgeType.VALUE_ORIGIN,
        EdgeType.REINGESTS,
        EdgeType.SESSION_REACHES,
        EdgeType.REACHES,
        EdgeType.HAS_ACTION,
        EdgeType.HAS_INPUT,
        EdgeType.HAS_TEST,
        EdgeType.FOUND_ON,
        EdgeType.RENDERED_ON,
      ]
      const allEdges = store.queryEdges() as GraphEdgeData[]
      const touching = allEdges.filter((edge) => edgeMatches(edge, focus.id, 'both', workflowEdgeTypes))
      return {
        ok: true,
        value: {
          focus: summarizeNode(store, focus.id),
          ordered: touching.filter((e) => e.type === EdgeType.ORDERED_BEFORE).map((e) => ({ from: summarizeNode(store, e.fromId), to: summarizeNode(store, e.toId), properties: e.properties })),
          valueFlow: touching.filter((e) => e.type === EdgeType.VALUE_ORIGIN || e.type === EdgeType.REINGESTS).map((e) => ({ type: e.type, from: summarizeNode(store, e.fromId), to: summarizeNode(store, e.toId), properties: e.properties })),
          reachability: touching.filter((e) => e.type === EdgeType.SESSION_REACHES || e.type === EdgeType.REACHES).map((e) => ({ type: e.type, from: summarizeNode(store, e.fromId), to: summarizeNode(store, e.toId), properties: e.properties })),
          neighborhood: buildNeighborhood(store, focus.id, { depth, direction: 'both', edgeTypes: workflowEdgeTypes, maxEdges: 120 }),
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const traceValue = createTool({
  id: 'traceValue',
  description:
    'Trace a recorded value or field name through graph edge properties. Returns matching edges and connected nodes; it is evidence, not a verdict.',
  inputSchema: z.object({
    value: z.string().optional(),
    fieldName: z.string().optional(),
    limit: z.number().int().min(0).max(500).optional().default(100),
  }).refine((v) => !!v.value || !!v.fieldName, { message: 'value or fieldName is required' }),
  execute: async ({ value, fieldName, limit }) => {
    try {
      const store = getGlobalGraphStore()
      const needles = [value, fieldName].filter((v): v is string => !!v)
      const edges = (store.queryEdges() as GraphEdgeData[]).filter((edge) => {
        const haystack = JSON.stringify(edge.properties ?? {})
        return needles.some((needle) => haystack.includes(needle))
      })
      const sliced = limit === 0 ? edges : edges.slice(0, limit)
      return {
        ok: true,
        value: {
          matchCount: edges.length,
          edges: sliced.map((edge) => ({
            id: edge.id,
            type: edge.type,
            from: summarizeNode(store, edge.fromId),
            to: summarizeNode(store, edge.toId),
            properties: edge.properties,
          })),
          truncated: limit !== 0 && edges.length > limit,
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const explainReachability = createTool({
  id: 'explainReachability',
  description:
    'Explain recorded role/session reachability from typed reachability edges. Use this to discuss which identity can reach which endpoint/page.',
  inputSchema: z.object({
    role: z.string().optional(),
    session: z.string().optional(),
    endpointId: z.string().optional(),
    endpointUrl: z.string().optional(),
  }),
  execute: async ({ role, session, endpointId, endpointUrl }) => {
    try {
      const store = getGlobalGraphStore()
      const focus = endpointId || endpointUrl
        ? findEndpointNode(store, endpointId, endpointUrl)
        : undefined
      const edges = (store.queryEdges() as GraphEdgeData[])
        .filter((edge) => edge.type === EdgeType.SESSION_REACHES || edge.type === EdgeType.REACHES)
        .filter((edge) => !focus || edge.toId === focus.id || edge.fromId === focus.id)
        .filter((edge) => !role || String(edge.properties?.role ?? edge.properties?.roleName ?? '').includes(role) || summarizeNode(store, edge.fromId).name === role)
        .filter((edge) => !session || String(edge.properties?.session ?? edge.properties?.sessionId ?? '').includes(session))
      return {
        ok: true,
        value: {
          focus: focus ? summarizeNode(store, focus.id) : undefined,
          edgeCount: edges.length,
          reaches: edges.map((edge) => ({
            type: edge.type,
            from: summarizeNode(store, edge.fromId),
            to: summarizeNode(store, edge.toId),
            properties: edge.properties,
          })),
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getUntestedWorkarounds = createTool({
  id: 'getUntestedWorkarounds',
  description:
    'Return structural workaround candidates around an endpoint that appear untested. Candidates come from workflow, value-flow, and reachability edges.',
  inputSchema: z.object({
    endpointId: z.string().optional(),
    endpointUrl: z.string().optional(),
  }).refine((v) => !!v.endpointId || !!v.endpointUrl, { message: 'endpointId or endpointUrl is required' }),
  execute: async ({ endpointId, endpointUrl }) => {
    try {
      const store = getGlobalGraphStore()
      const focus = findEndpointNode(store, endpointId, endpointUrl)
      if (!focus) return { ok: false, error: 'Endpoint not found' }
      const edges = store.queryEdges() as GraphEdgeData[]
      const touching = edges.filter((edge) => edge.fromId === focus.id || edge.toId === focus.id)
      const tested = touching.some((edge) => edge.type === EdgeType.HAS_TEST)
      const candidateEdgeTypes = new Set<EdgeType>([
        EdgeType.ORDERED_BEFORE,
        EdgeType.REINGESTS,
        EdgeType.VALUE_ORIGIN,
        EdgeType.SESSION_REACHES,
        EdgeType.REACHES,
      ])
      const candidates = touching
        .filter((edge) => candidateEdgeTypes.has(edge.type))
        .map((edge) => ({
          kind: edge.type,
          focus: summarizeNode(store, focus.id),
          related: summarizeNode(store, edge.fromId === focus.id ? edge.toId : edge.fromId),
          tested,
          rationale:
            edge.type === EdgeType.ORDERED_BEFORE ? 'workflow ordering may allow direct step access'
            : edge.type === EdgeType.REINGESTS || edge.type === EdgeType.VALUE_ORIGIN ? 'value crosses endpoint boundary and may be reusable or mutable'
            : 'recorded reachability may differ by role/session',
          evidence: edge.properties,
        }))
      return { ok: true, value: { focus: summarizeNode(store, focus.id), tested, candidates } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
