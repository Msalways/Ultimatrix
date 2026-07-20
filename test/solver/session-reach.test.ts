import { describe, it, expect } from 'vitest'
import { recordSessionReach } from '../../src/solver/exploitation-loop'
import { NodeType, EdgeType } from '../../src/graph/schema'

// Fake structural graph store: records edges + lets us assert the reach fact.
function fakeStore() {
  const edges: Array<{ fromId: string; toId: string; type: string }> = []
  const role = { id: 'role:admin', properties: { roleName: 'admin', accessibleEndpoints: [] as string[] } }
  const endpoint = { id: 'ep:1', properties: { url: 'https://t.example/admin/users' } }
  return {
    queryNodes: (t: string) => (t === NodeType.RBAC_ROLE ? [role] : t === NodeType.ENDPOINT ? [endpoint] : []),
    addEdge: (e: any) => {
      edges.push(e)
      return e
    },
    edges,
    role,
    endpoint,
  } as any
}

describe('recordSessionReach (cross-cutting held-session reach)', () => {
  it('writes a SESSION_REACHES edge + updates accessibleEndpoints for the held role', () => {
    const store = fakeStore()
    recordSessionReach(store, 'admin', 'f:1', 'https://t.example/admin/users')

    expect(store.edges).toHaveLength(1)
    expect(store.edges[0].type).toBe(EdgeType.SESSION_REACHES)
    expect(store.edges[0].fromId).toBe('role:admin')
    expect(store.edges[0].toId).toBe('ep:1')
    expect(store.edges[0].properties.viaFinding).toBe('f:1')
    expect(store.role.properties.accessibleEndpoints).toContain('https://t.example/admin/users')
  })

  it('no-ops when no matching role node exists (no false reach fact)', () => {
    const store = fakeStore()
    recordSessionReach(store, 'ghost', 'f:1', 'https://t.example/admin/users')
    expect(store.edges).toHaveLength(0)
  })
})
