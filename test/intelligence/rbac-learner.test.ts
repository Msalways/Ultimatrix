import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({ createTool: (c: any) => c }))
vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => globalThis.__store }))

import { learnRBACFromMatrix } from '../../src/intelligence/rbac-learner'
import { EdgeType } from '../../src/graph/schema'

function makeStore() {
  const roles: any[] = []
  const edges: any[] = []
  const endpoints = [{ id: 'ep1', properties: { endpoint: 'https://app/api/admin' } }]
  return {
    addRBACRole: (d: any) => { const n = { id: `role-${roles.length}`, properties: d }; roles.push(n); return n },
    queryNodes: (t: string) => (t === 'Endpoint' ? endpoints : []),
    addEdge: (e: any) => { edges.push(e); return e },
    save: () => {},
    _roles: roles,
    _edges: edges,
  }
}

describe('learnRBACFromMatrix', () => {
  beforeEach(() => { globalThis.__store = makeStore() })

  it('creates RBACRole nodes + relation edges from the matrix', () => {
    const store: any = globalThis.__store
    const roles = learnRBACFromMatrix([
      { role: 'admin', baseUrl: 'https://app', headers: {}, ownedObjectIds: [], reachableEndpoints: ['https://app/api/admin'] },
    ])
    expect(roles.length).toBe(1)
    expect(store._roles[0].properties.roleName).toBe('admin')
    // REQUIRES_ROLE + HAS_ROLE + PERMISSION = 3 edges
    expect(store._edges.length).toBe(3)
    const types = store._edges.map((e: any) => e.type)
    expect(types).toContain(EdgeType.REQUIRES_ROLE)
    expect(types).toContain(EdgeType.HAS_ROLE)
    expect(types).toContain(EdgeType.PERMISSION)
    expect(store._edges.find((e: any) => e.type === EdgeType.PERMISSION).properties).toEqual({ access: 'granted' })
  })

  it('maps reachable endpoints to existing Endpoint node ids', () => {
    const store: any = globalThis.__store
    learnRBACFromMatrix([{ role: 'r', baseUrl: 'https://app', headers: {}, ownedObjectIds: [], reachableEndpoints: ['https://app/api/admin'] }])
    expect(store._edges[0].fromId).toBe('ep1')
  })
})
