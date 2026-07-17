import { describe, it, expect, vi } from 'vitest'
import {
  normalizedEndpointKey,
  buildReingestEdges,
  buildOrderingEdges,
} from '../../src/graph/relations'
import { NodeType, EdgeType } from '../../src/graph/schema'

function fakeStore() {
  const edges: Array<{ fromId: string; toId: string; type: EdgeType; properties: Record<string, unknown> }> = []
  return {
    edges,
    queryNodes: vi.fn((type?: NodeType) => {
      if (type === NodeType.ENDPOINT) return endpoints
      return []
    }),
    queryEdges: vi.fn(() => edges),
    addEdge: vi.fn((e: any) => {
      edges.push(e)
      return e
    }),
  }
}

const endpoints = [
  {
    id: 'epA',
    type: NodeType.ENDPOINT,
    properties: { url: 'https://x.com/users/42', method: 'GET', params: [] },
  },
  {
    id: 'epB',
    type: NodeType.ENDPOINT,
    properties: { url: 'https://x.com/users/99/orders', method: 'POST', params: [] },
  },
  {
    id: 'epC',
    type: NodeType.ENDPOINT,
    properties: { url: 'https://x.com/orders/42', method: 'GET', params: [] },
  },
]

describe('graph/relations: normalizedEndpointKey', () => {
  it('collapses an id-shaped path segment to :id', () => {
    const k1 = normalizedEndpointKey('GET', 'https://x.com/users/42')
    const k2 = normalizedEndpointKey('GET', 'https://x.com/users/99')
    expect(k1).toBe(k2)
    expect(k1).toBe('GET:https://x.com/users/:id')
  })

  it('differs when the resource shape differs', () => {
    const users = normalizedEndpointKey('GET', 'https://x.com/users/42')
    const orders = normalizedEndpointKey('GET', 'https://x.com/orders/42')
    expect(users).not.toBe(orders)
  })
})

describe('graph/relations: buildReingestEdges', () => {
  it('creates a REINGESTS edge when a value flows across two distinct endpoints', () => {
    const store = fakeStore()
    const built = buildReingestEdges(store, [
      {
        sourceEndpointUrl: 'https://x.com/users/42',
        sourceKind: 'response-field',
        sinkMethod: 'POST',
        sinkUrl: 'https://x.com/users/99/orders',
        valueSample: '42',
      },
    ])
    expect(built).toBe(1)
    expect(store.addEdge).toHaveBeenCalledTimes(1)
    const edge = store.addEdge.mock.calls[0][0]
    expect(edge.type).toBe(EdgeType.REINGESTS)
    expect(edge.fromId).toBe('epA')
    expect(edge.toId).toBe('epB')
    expect(edge.properties.valueSample).toBe('42')
  })

  it('does not create an edge for a skipped (UI-input, no source endpoint) origin', () => {
    const store = fakeStore()
    const built = buildReingestEdges(store, [
      { sourceKind: 'ui-input', sinkMethod: 'POST', sinkUrl: 'https://x.com/users/99/orders', valueSample: '42' },
    ])
    expect(built).toBe(0)
    expect(store.addEdge).not.toHaveBeenCalled()
  })
})

describe('graph/relations: buildOrderingEdges', () => {
  it('creates ORDERED_BEFORE edges for consecutive ids in the supplied sequence', () => {
    const store = fakeStore()
    const built = buildOrderingEdges(store, ['epA', 'epB', 'epC'])
    expect(built).toBe(2)
    const types = store.addEdge.mock.calls.map((c: any[]) => c[0].type)
    expect(types).toEqual([EdgeType.ORDERED_BEFORE, EdgeType.ORDERED_BEFORE])
    expect(store.addEdge.mock.calls[0][0].properties.order).toBe(0)
    expect(store.addEdge.mock.calls[1][0].properties.order).toBe(1)
  })

  it('skips a self-loop (consecutive identical id)', () => {
    const store = fakeStore()
    const built = buildOrderingEdges(store, ['epA', 'epA', 'epB'])
    expect(built).toBe(1)
  })
})
