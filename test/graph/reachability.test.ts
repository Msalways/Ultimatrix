import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { GraphStore } from '../../src/graph/store'
import { NodeType, EdgeType } from '../../src/graph/schema'
import { createReachability } from '../../src/identity/reachability'
import type { ReachabilityRecord } from '../../src/identity/types'

const tmpDir = join(tmpdir(), 'ultimatrix-reachability-test')

const TARGET = 'https://reach-graph.example.com'

function record(overrides: Partial<ReachabilityRecord> = {}): ReachabilityRecord {
  return {
    ...createReachability('wf-reach', { id: 'anonymous', kind: 'anonymous', label: 'Anonymous' }, 'page', `${TARGET}/`, '2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('REACHABILITY graph nodes (Slice 06)', () => {
  let store: GraphStore
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    store = new GraphStore(join(tmpDir, 'graph.json'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('adds a Reachability node and links it to the reached resource via REACHES', () => {
    const ep = store.addEndpoint({ url: `${TARGET}/api`, method: 'GET' })
    const node = store.addReachability({ ...record({ resourceType: 'endpoint', resourceId: `${TARGET}/api` }) })

    expect(node.type).toBe(NodeType.REACHABILITY)
    expect(node.properties).toMatchObject({ identityId: 'anonymous', resourceType: 'endpoint', resourceId: `${TARGET}/api`, workflowId: 'wf-reach' })

    const edges = store.queryEdges({ fromId: node.id, type: EdgeType.REACHES })
    expect(edges).toHaveLength(1)
    expect(edges[0].toId).toBe(ep.id)
  })

  it('wires HAS_ROLE from a matching RBACRole node to the reachability node', () => {
    const role = store.addRBACRole({ roleName: 'Administrator', permissions: ['users.read'], scope: 'users' })
    const node = store.addReachability({
      ...record({
        identityId: 'admin:administrator',
        resourceType: 'endpoint',
        resourceId: `${TARGET}/admin`,
      }),
      identityKind: 'admin',
      roleName: 'Administrator',
    })

    const edges = store.queryEdges({ fromId: role.id, type: EdgeType.HAS_ROLE })
    expect(edges).toHaveLength(1)
    expect(edges[0].toId).toBe(node.id)
  })

  it('dedupes by identity+resource, refreshing reachedAt on re-record', () => {
    store.addEndpoint({ url: `${TARGET}/api`, method: 'GET' })
    store.addReachability({ ...record({ resourceType: 'endpoint', resourceId: `${TARGET}/api` }), reachedAt: '2026-01-01T00:00:00.000Z' })
    store.addReachability({ ...record({ resourceType: 'endpoint', resourceId: `${TARGET}/api` }), reachedAt: '2026-02-01T00:00:00.000Z' })

    const nodes = store.queryNodes(NodeType.REACHABILITY)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].properties.reachedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('keeps anonymous and authenticated reach distinct for the same resource', () => {
    store.addEndpoint({ url: `${TARGET}/admin`, method: 'GET' })
    store.addReachability({ ...record({ resourceType: 'endpoint', resourceId: `${TARGET}/admin` }) })
    store.addReachability({
      ...record({ resourceType: 'endpoint', resourceId: `${TARGET}/admin` }),
      identityId: 'authenticated:operator',
      identityKind: 'authenticated',
    })

    const nodes = store.queryNodes(NodeType.REACHABILITY)
    expect(nodes).toHaveLength(2)
  })

  it('matches INPUT resources by URL for the REACHES edge', () => {
    const input = store.addInput('page-login', { url: `${TARGET}/login`, selector: '#q', inputType: 'text', name: 'q' })
    store.addReachability({ ...record({ resourceType: 'form', resourceId: `${TARGET}/login` }) })

    const reach = store.queryNodes(NodeType.REACHABILITY)[0]
    const edges = store.queryEdges({ fromId: reach.id, type: EdgeType.REACHES })
    expect(edges).toHaveLength(1)
    expect(edges[0].toId).toBe(input.id)
  })
})
