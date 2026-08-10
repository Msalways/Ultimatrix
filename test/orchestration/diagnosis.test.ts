/**
 * Diagnosis tests (Phase 9 / T2 + T8).
 *
 * Diagnosis reads STRUCTURED graph state (param shapes, typed tags, headers,
 * relations, auth nodes) and emits signals + missing context + ranked
 * techniques. It NEVER writes to the graph.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/oast/server', () => ({
  getOastUrl: () => 'http://oast-not-started',
}))

const mockStore = {
  queryNodes: vi.fn(),
  getAllEdges: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

import '../../src/primitives'

function endpoint(overrides: Partial<any> = {}) {
  return {
    id: 'ep1',
    type: 'Endpoint',
    properties: {
      url: 'https://app.test/api/users/1',
      method: 'GET',
      params: [],
      headers: {},
      ...overrides,
    },
  }
}

function resetStore() {
  vi.clearAllMocks()
  mockStore.queryNodes.mockReturnValue([])
  mockStore.getAllEdges.mockReturnValue([])
}

async function loadDiagnosis() {
  const mod = await import('../../src/orchestration/diagnosis')
  return mod
}

describe('diagnoseTargetState', () => {
  beforeEach(resetStore)

  it('returns discovery gap when no endpoints are captured', async () => {
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    expect(profile.summary.hasEndpoints).toBe(false)
    expect(profile.missingContext.some((m) => m.context === 'discovery')).toBe(true)
  })

  it('detects object-id and url-like param signals from param shapes', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [
          endpoint({
            url: 'https://app.test/api/orders',
            method: 'POST',
            params: [{ name: 'accountId', type: 'string' }, { name: 'callbackUrl', type: 'string' }],
          }),
        ]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    const names = profile.attackSurfaces.map((s) => s.name)
    expect(names).toContain('object-id-param')
    expect(names).toContain('url-like-param')
    expect(profile.knownContext.objectIdParams).toContain('accountId')
    expect(profile.knownContext.urlLikeParams).toContain('callbackUrl')
  })

  it('flags auth signals + missing second-user/session-headers for authenticated endpoints', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ authRequired: true, authType: 'Bearer', params: [{ name: 'userId', type: 'string' }] })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    expect(profile.attackSurfaces.some((s) => s.name === 'auth-bound')).toBe(true)
    expect(profile.summary.hasAuth).toBe(true)
    const contexts = profile.missingContext.map((m) => m.context)
    expect(contexts).toContain('second-user')
    expect(contexts).toContain('session-headers')
  })

  it('flags oast-host gap for url-shaped params when no OAST is configured', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ url: 'https://app.test/fetch', params: [{ name: 'webhook', type: 'string' }] })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    expect(profile.missingContext.some((m) => m.context === 'oast-host')).toBe(true)
    expect(profile.knownContext.hasOast).toBe(false)
  })

  it('treats OAST as configured when input.oastHost is provided', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ url: 'https://app.test/fetch', params: [{ name: 'webhook', type: 'string' }] })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({ oastHost: 'oast.example.com' })
    expect(profile.knownContext.hasOast).toBe(true)
    expect(profile.missingContext.some((m) => m.context === 'oast-host')).toBe(false)
  })

  it('detects graphql surface from URL path', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ url: 'https://app.test/graphql', method: 'POST' })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    expect(profile.attackSurfaces.some((s) => s.name === 'graphql')).toBe(true)
    expect(profile.knownContext.graphqlEndpoints).toContain('https://app.test/graphql')
  })

  it('detects custom-header and proxy surfaces from captured headers', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({
          url: 'https://app.test/admin',
          headers: { 'X-Custom': '1', 'X-Forwarded-For': '1.2.3.4', Host: 'app.test' },
        })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    const names = profile.attackSurfaces.map((s) => s.name)
    expect(names).toContain('custom-header')
    expect(names).toContain('proxy-hint')
  })

  it('detects relation-driven signals (second-order, workflow-order) from edges', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [
          endpoint({ id: 'ep1', url: 'https://app.test/a', method: 'GET' }),
          endpoint({ id: 'ep2', url: 'https://app.test/b', method: 'POST' }),
        ]
      }
      return []
    })
    mockStore.getAllEdges.mockReturnValue([
      { type: 'REINGESTS', fromId: 'ep1', toId: 'ep2' },
      { type: 'ORDERED_BEFORE', fromId: 'ep1', toId: 'ep2' },
    ])
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    const names = profile.attackSurfaces.map((s) => s.name)
    expect(names).toContain('second-order')
    expect(names).toContain('workflow-order')
    expect(profile.summary.relationCount).toBe(2)
  })

  it('reads RBAC roles and auth flows from the graph', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ authRequired: true })]
      }
      if (type === 'RBACRole') {
        return [{ id: 'role1', properties: { roleName: 'admin' } }]
      }
      if (type === 'AuthFlow') {
        return [{ id: 'flow1', properties: { flowType: 'login' } }]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    expect(profile.knownContext.roles).toContain('admin')
    expect(profile.knownContext.authFlows).toContain('login')
    expect(profile.summary.authFlowCount).toBe(1)
    expect(profile.summary.rbacRoleCount).toBe(1)
  })

  it('ranks primitives for the diagnosed surface (SSRF for url-like params)', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ url: 'https://app.test/fetch', params: [{ name: 'callback', type: 'string' }] })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({ maxCandidates: 5 })
    expect(profile.rankedTechniques.length).toBeGreaterThan(0)
    expect(profile.recommendedPrimitives.length).toBeGreaterThan(0)
    const top = profile.rankedTechniques[0]
    expect(top.primitiveId).toBeTruthy()
    expect(top.reason.length).toBeGreaterThan(0)
    expect(top.endpointId).toBe('ep1')
  })

  it('flags alternate-object-id gap for object-id params without a second session', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ url: 'https://app.test/api/orders', params: [{ name: 'order_id', type: 'string' }] })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    const ctxs = profile.missingContext.map((m) => m.context)
    expect(ctxs).toContain('alternate-object-id')
    expect(profile.missingContext.find((m) => m.context === 'alternate-object-id')!.priority).toBe('medium')
  })

  it('flags workflow-steps gap for multi-step workflows', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ url: 'https://app.test/checkout' })]
      }
      if (type === 'Workflow') {
        return [{ id: 'wf1', properties: { name: 'checkout', steps: [{ action: 'add' }, { action: 'pay' }] } }]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    const profile = diagnoseTargetState({})
    const ctxs = profile.missingContext.map((m) => m.context)
    expect(ctxs).toContain('workflow-steps')
    expect(profile.summary.workflowCount).toBe(1)
  })

  it('never mutates the store', async () => {
    mockStore.queryNodes.mockImplementation((type: string) => {
      if (type === 'Endpoint') {
        return [endpoint({ authRequired: true, params: [{ name: 'userId', type: 'string' }] })]
      }
      return []
    })
    const { diagnoseTargetState } = await loadDiagnosis()
    diagnoseTargetState({})
    const mutationCalls = mockStore.getAllEdges.mock.calls // diagnosis reads edges once
    expect(mockStore.save).not.toHaveBeenCalled()
    // only reads are allowed: getAllEdges is read-only, no add*/write calls
    expect(mutationCalls.length).toBeGreaterThanOrEqual(1)
  })
})
