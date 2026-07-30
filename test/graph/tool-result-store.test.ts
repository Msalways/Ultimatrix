import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToolResultStore, resetToolResultStore } from '../../src/graph/tool-result-store'

const mockStore = {
  queryNodes: vi.fn().mockReturnValue([]),
  upsertNode: vi.fn().mockImplementation((node: any) => node),
}

describe('ToolResultStore', () => {
  let store: ToolResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resetToolResultStore()
    store = new ToolResultStore(mockStore as any)
  })

  it('store() returns a compact reference', () => {
    const ref = store.store('httpRequest', { status: 200, body: 'hello' }, { url: 'http://test.com' })

    expect(ref.graphNodeId).toContain('tool-result:httpRequest:')
    expect(ref.tool).toBe('httpRequest')
    expect(ref.summary).toContain('httpRequest')
    expect(ref.sizeBytes).toBeGreaterThan(0)
  })

  it('store() creates a graph node with kind=toolResult', () => {
    store.store('parseResponse', { status: 200, body: 'test' })

    expect(mockStore.upsertNode).toHaveBeenCalledTimes(1)
    const node = mockStore.upsertNode.mock.calls[0][0]
    expect(node.type).toBe('Entity')
    expect(node.properties.kind).toBe('toolResult')
    expect(node.properties.tool).toBe('parseResponse')
    expect(typeof node.properties.data).toBe('string')
  })

  it('get() retrieves full data from stored ref', () => {
    const ref = store.store('httpRequest', { status: 200, body: 'test data' })

    mockStore.queryNodes.mockReturnValue([{
      id: ref.graphNodeId,
      type: 'Entity',
      properties: {
        kind: 'toolResult',
        tool: 'httpRequest',
        data: JSON.stringify({ status: 200, body: 'test data' }),
        summary: 'httpRequest: {...}',
        sizeBytes: 100,
      },
    }])

    const data = store.get(ref.graphNodeId)
    expect(data).toEqual({ status: 200, body: 'test data' })
  })

  it('get() returns null for non-existent node', () => {
    mockStore.queryNodes.mockReturnValue([])
    const data = store.get('non-existent-id')
    expect(data).toBeNull()
  })

  it('get() returns null for non-toolResult node', () => {
    mockStore.queryNodes.mockReturnValue([{
      id: 'page:1',
      type: 'Page',
      properties: { url: 'http://test.com' },
    }])
    const data = store.get('page:1')
    expect(data).toBeNull()
  })

  it('buildSummary() generates short previews', () => {
    const shortRef = store.store('test', 'short text')
    expect(shortRef.summary).toContain('short text')

    const longRef = store.store('test', 'x'.repeat(500))
    expect(longRef.summary.length).toBeLessThan(250)

    const objRef = store.store('test', { foo: 'bar', baz: 123, qux: true, quux: 'a', corge: 'b' })
    expect(objRef.summary).toContain('{')
    expect(objRef.summary).toContain('foo')
  })

  it('getToolResultStore() returns singleton', async () => {
    const { getToolResultStore } = await import('../../src/graph/tool-result-store')
    const s1 = getToolResultStore(mockStore as any)
    resetToolResultStore()
    const s2 = getToolResultStore(mockStore as any)
    expect(s1).not.toBe(s2) // different after reset
  })
})
