import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const mockStore = {
  queryNodes: vi.fn(),
  queryEdges: vi.fn(),
  addEdge: vi.fn(),
  getNode: vi.fn((id: string) => ({ id, type: 'Endpoint', properties: { url: `https://app.test/${id}`, method: 'GET' } })),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

async function callTool(tool: any, args: any) {
  return tool.execute(args, {})
}

describe('relation-tools (no hardcoded vocab)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getGraphSchema', () => {
    it('reflects live node/edge vocabulary from the registry (no frozen list in code)', async () => {
      const { getGraphSchema } = await import('../../src/graph/relation-tools')
      mockStore.queryEdges.mockReturnValue([])
      const result = await callTool(getGraphSchema, {})
      expect(result.ok).toBe(true)
      // The vocabulary must come from the enum, not a hardcoded array literal.
      expect(Array.isArray(result.value.nodeTypes)).toBe(true)
      expect(result.value.nodeTypes.length).toBeGreaterThan(0)
      expect(result.value.nodeTypes).toContain('Endpoint')
      expect(Array.isArray(result.value.edgeTypes)).toBe(true)
      expect(result.value.edgeTypes).toContain('VALUE_ORIGIN')
    })

    it('surfaces edge types actually present in the graph', async () => {
      const { getGraphSchema } = await import('../../src/graph/relation-tools')
      mockStore.queryEdges.mockReturnValue([{ type: 'PROVENANCE' }, { type: 'REINGESTS' }])
      const result = await callTool(getGraphSchema, {})
      expect(result.value.edgeTypes).toContain('PROVENANCE')
      expect(result.value.edgeTypes).toContain('REINGESTS')
    })
  })

  describe('getCaptureOverview', () => {
    it('returns structural metadata with no bodies and no truncation', async () => {
      const { getCaptureOverview } = await import('../../src/graph/relation-tools')
      mockStore.queryNodes.mockImplementation((type: string) => {
        if (type === 'Endpoint') {
          return [
            { id: 'ep1', properties: { url: 'https://app.test/api/a', method: 'GET', params: [] } },
            { id: 'ep2', properties: { url: 'https://app.test/api/b', method: 'POST', params: [{ name: 'orderId' }] } },
          ]
        }
        return []
      })
      mockStore.queryEdges.mockReturnValue([
        { fromId: 'ep1', toId: 'ep2', type: 'VALUE_ORIGIN' },
      ])
      const result = await callTool(getCaptureOverview, {})
      expect(result.ok).toBe(true)
      expect(result.value.endpointCount).toBe(2)
      expect(result.value.methodCounts).toEqual({ GET: 1, POST: 1 })
      expect(result.value.edgeTypeCounts).toEqual({ VALUE_ORIGIN: 1 })
      expect(result.value.endpoints[1].paramNames).toEqual(['orderId'])
    })

    it('does not assert any specific edge/relation vocabulary in its description', async () => {
      const { getCaptureOverview } = await import('../../src/graph/relation-tools')
      const desc: string = getCaptureOverview.description
      // The description must not enumerate node/edge type names as a frozen list.
      expect(desc).not.toMatch(/Types:\s*Page,/)
      expect(desc).not.toMatch(/PROVENANCE,\s*REINGESTS,\s*ORDERED_BEFORE/)
      expect(desc.toLowerCase()).toContain('getgraphschema')
    })

    it('reports originCounts so the LLM can scope self-traffic out structurally', async () => {
      const { getCaptureOverview } = await import('../../src/graph/relation-tools')
      mockStore.queryNodes.mockImplementation((type: string) => {
        if (type === 'Endpoint') {
          return [
            { id: 'ep1', properties: { url: 'https://app.test/api/a', method: 'GET', params: [], origin: 'target' } },
            { id: 'ep2', properties: { url: 'https://oast.example.com/cb/x', method: 'GET', params: [], origin: 'self' } },
          ]
        }
        return []
      })
      mockStore.queryEdges.mockReturnValue([])
      const result = await callTool(getCaptureOverview, {})
      expect(result.value.originCounts).toEqual({ target: 1, self: 1 })
      expect(result.value.endpoints.find((e: any) => e.id === 'ep2').origin).toBe('self')
    })
  })

  describe('queryRelations', () => {
    it('returns REINGESTS edges and populated reingestSeeds when filtered by relationType', async () => {
      const { queryRelations } = await import('../../src/graph/relation-tools')
      mockStore.queryEdges.mockReturnValue([
        {
          id: 'e1',
          fromId: 'epA',
          toId: 'epB',
          type: 'REINGESTS',
          properties: { sourceKind: 'response-field', valueSample: '42' },
        },
        { id: 'e2', fromId: 'epC', toId: 'epD', type: 'VALUE_ORIGIN', properties: {} },
      ])
      const result = await callTool(queryRelations, { relationType: 'REINGESTS' })
      expect(result.ok).toBe(true)
      expect(result.value.edgeCount).toBeGreaterThanOrEqual(1)
      expect(result.value.reingestSeeds.length).toBeGreaterThanOrEqual(1)
      expect(result.value.reingestSeeds[0].relation).toBe('reingest')
      expect(result.value.reingestSeeds[0].valueSample).toBe('42')
    })

    it('does not assert a hardcoded relation vocabulary in its description', async () => {
      const { queryRelations } = await import('../../src/graph/relation-tools')
      const desc: string = queryRelations.description
      expect(desc.toLowerCase()).toContain('getgraphschema')
      expect(desc).not.toMatch(/REINGESTS,\s*VALUE_ORIGIN,\s*ORDERED_BEFORE/)
    })
  })

  describe('graph memory loaders', () => {
    it('loads a parent/child neighborhood around a focus node', async () => {
      const { getGraphNeighborhood } = await import('../../src/graph/relation-tools')
      mockStore.getNode.mockImplementation((id: string) => ({ id, type: 'Endpoint', label: id, properties: { url: `https://app.test/${id}`, method: 'GET' } }))
      mockStore.queryEdges.mockReturnValue([
        { id: 'e1', fromId: 'page:checkout', toId: 'ep:checkout', type: 'HAS_ACTION', properties: {} },
        { id: 'e2', fromId: 'ep:checkout', toId: 'ep:confirm', type: 'ORDERED_BEFORE', properties: {} },
      ])

      const result = await callTool(getGraphNeighborhood, { nodeId: 'ep:checkout', depth: 1 })

      expect(result.ok).toBe(true)
      expect(result.value.focus.id).toBe('ep:checkout')
      expect(result.value.nodes.map((n: any) => n.id)).toEqual(expect.arrayContaining(['page:checkout', 'ep:confirm']))
      expect(result.value.edges.map((e: any) => e.type)).toEqual(expect.arrayContaining(['HAS_ACTION', 'ORDERED_BEFORE']))
    })

    it('loads workflow context and value-flow evidence around an endpoint URL', async () => {
      const { getWorkflowAround } = await import('../../src/graph/relation-tools')
      mockStore.queryNodes.mockImplementation((type: string, filters?: any) => {
        if (type !== 'Endpoint') return []
        const nodes = [
          { id: 'ep:checkout', type: 'Endpoint', label: 'checkout', properties: { url: 'https://app.test/api/checkout', method: 'POST' } },
        ]
        return filters?.url ? nodes.filter((n) => n.properties.url === filters.url) : nodes
      })
      mockStore.getNode.mockImplementation((id: string) => ({ id, type: 'Endpoint', label: id, properties: { url: `https://app.test/${id}`, method: 'POST' } }))
      mockStore.queryEdges.mockReturnValue([
        { id: 'e1', fromId: 'ep:cart', toId: 'ep:checkout', type: 'REINGESTS', properties: { valueSample: 'order-1' } },
        { id: 'e2', fromId: 'role:user', toId: 'ep:checkout', type: 'SESSION_REACHES', properties: { role: 'user' } },
      ])

      const result = await callTool(getWorkflowAround, { endpointUrl: 'https://app.test/api/checkout' })

      expect(result.ok).toBe(true)
      expect(result.value.focus.id).toBe('ep:checkout')
      expect(result.value.valueFlow).toHaveLength(1)
      expect(result.value.reachability).toHaveLength(1)
    })

    it('traces recorded edge property values structurally', async () => {
      const { traceValue } = await import('../../src/graph/relation-tools')
      mockStore.queryEdges.mockReturnValue([
        { id: 'e1', fromId: 'ep:a', toId: 'ep:b', type: 'VALUE_ORIGIN', properties: { field: 'orderId', valueSample: '42' } },
        { id: 'e2', fromId: 'ep:c', toId: 'ep:d', type: 'ORDERED_BEFORE', properties: {} },
      ])

      const result = await callTool(traceValue, { fieldName: 'orderId' })

      expect(result.ok).toBe(true)
      expect(result.value.matchCount).toBe(1)
      expect(result.value.edges[0].type).toBe('VALUE_ORIGIN')
    })

    it('explains typed reachability edges', async () => {
      const { explainReachability } = await import('../../src/graph/relation-tools')
      mockStore.queryEdges.mockReturnValue([
        { id: 'e1', fromId: 'role:admin', toId: 'ep:admin', type: 'SESSION_REACHES', properties: { role: 'admin' } },
        { id: 'e2', fromId: 'role:user', toId: 'ep:user', type: 'SESSION_REACHES', properties: { role: 'user' } },
      ])

      const result = await callTool(explainReachability, { role: 'admin' })

      expect(result.ok).toBe(true)
      expect(result.value.edgeCount).toBe(1)
      expect(result.value.reaches[0].from.id).toBe('role:admin')
    })

    it('returns untested workaround candidates from workflow/value/reachability edges', async () => {
      const { getUntestedWorkarounds } = await import('../../src/graph/relation-tools')
      mockStore.queryNodes.mockImplementation((type: string, filters?: any) => {
        if (type !== 'Endpoint') return []
        const nodes = [
          { id: 'ep:confirm', type: 'Endpoint', label: 'confirm', properties: { url: 'https://app.test/api/confirm', method: 'POST' } },
        ]
        return filters?.url ? nodes.filter((n) => n.properties.url === filters.url) : nodes
      })
      mockStore.queryEdges.mockReturnValue([
        { id: 'e1', fromId: 'ep:payment', toId: 'ep:confirm', type: 'ORDERED_BEFORE', properties: {} },
        { id: 'e2', fromId: 'ep:cart', toId: 'ep:confirm', type: 'REINGESTS', properties: { valueSample: 'order-1' } },
      ])

      const result = await callTool(getUntestedWorkarounds, { endpointUrl: 'https://app.test/api/confirm' })

      expect(result.ok).toBe(true)
      expect(result.value.tested).toBe(false)
      expect(result.value.candidates.map((c: any) => c.kind)).toEqual(expect.arrayContaining(['ORDERED_BEFORE', 'REINGESTS']))
    })
  })
})
