/**
 * Campaign planner signal-routing tests (Phase 9 / T6 + T8).
 *
 * Endpoint signals (graphql / state-changing / object-id / url-like / custom-header)
 * route technique tags to the RIGHT endpoint and boost their priority — instead of
 * blanket-relevant tags matching any parameterized endpoint.
 */
import { describe, it, expect } from 'vitest'
import { planCampaign } from '../../src/campaign/planner'
import type { PrimitiveRef } from '../../src/campaign/types'
import { listPrimitiveMetadata } from '../../src/primitives'

function endpoint(overrides: Partial<any> = {}): any {
  return {
    id: 'ep1',
    type: 'Endpoint',
    properties: {
      url: 'https://app.test/fetch',
      method: 'GET',
      params: [],
      headers: {},
      ...overrides,
    },
  }
}

function primitive(id: string, tags: string[]): PrimitiveRef {
  return { id, description: id, tags }
}

function store(eps: any[], edges: any[] = []) {
  return {
    queryNodes: (type: string) => {
      if (type === 'Endpoint') return eps
      return []
    },
    getAllEdges: () => edges,
  } as any
}

describe('planCampaign signal routing', () => {
  it('feeds the campaign tool non-empty derived tags (T6 root cause guard)', () => {
    const metadata = listPrimitiveMetadata()
    expect(metadata.length).toBeGreaterThan(0)
    for (const m of metadata) {
      expect(m.tags.length, `${m.id} must have derived tags, not []`).toBeGreaterThan(0)
    }
  })

  it('routes url-like param endpoints to ssrf-tagged primitives with a signal boost', () => {
    const ep = endpoint({
      url: 'https://app.test/fetch',
      params: [{ name: 'callback', type: 'string' }],
    })
    const prims = [primitive('ssrfOast', ['ssrf', 'oast']), primitive('classicInjection', ['sqli'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice).toBeDefined()
    expect(slice!.techniqueIds).toContain('ssrfOast')
    expect(slice!.reason).toContain('signals: url-like-param')
    // base(hasParams) 1 + signalBoost 3
    expect(slice!.priority).toBeGreaterThanOrEqual(4)
  })

  it('routes graphql endpoints to graphql-tagged primitives even without params', () => {
    const ep = endpoint({ url: 'https://app.test/graphql', method: 'POST', params: [] })
    const prims = [primitive('graphqlBola', ['graphql', 'bola']), primitive('classicInjection', ['sqli'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice).toBeDefined()
    expect(slice!.techniqueIds).toContain('graphqlBola')
    expect(slice!.reason).toContain('graphql')
    // state-changing 0 + graphql boost 3
    expect(slice!.priority).toBeGreaterThanOrEqual(3)
  })

  it('keeps auth-bound techniques off unauthenticated, param-less endpoints', () => {
    const ep = endpoint({ url: 'https://app.test/status' })
    const prims = [primitive('authzMatrix', ['authz', 'authorization'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice).toBeUndefined()
    expect(plan.coverage.slicesPlanned).toBe(0)
  })

  it('includes auth-bound techniques for authenticated endpoints and adds auth priority', () => {
    const ep = endpoint({ url: 'https://app.test/me', authRequired: true, params: [{ name: 'userId', type: 'string' }] })
    const prims = [primitive('authzMatrix', ['authz']), primitive('idorSwapper', ['idor'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice).toBeDefined()
    expect(slice!.role).toBe('authenticated')
    expect(slice!.techniqueIds).toEqual(expect.arrayContaining(['authzMatrix', 'idorSwapper']))
    // authenticated 2 + object-id signal boost 3 + hasParams 1
    expect(slice!.priority).toBeGreaterThanOrEqual(6)
  })

  it('keeps generic recon techniques relevant to any endpoint', () => {
    const ep = endpoint({ url: 'https://app.test/robots.txt' })
    const prims = [primitive('recon', ['recon', 'info-disclosure'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice).toBeDefined()
    expect(slice!.techniqueIds).toContain('recon')
  })

  it('respects techniqueFilter', () => {
    const ep = endpoint({ url: 'https://app.test/fetch', params: [{ name: 'url', type: 'string' }] })
    const prims = [primitive('ssrfOast', ['ssrf']), primitive('classicInjection', ['sqli'])]
    const plan = planCampaign(store([ep]), { primitives: prims, techniqueFilter: ['ssrfOast'] })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice!.techniqueIds).toEqual(['ssrfOast'])
  })

  it('object-id signal routes idor-tagged primitives with a boost over param-only relevance', () => {
    const ep = endpoint({
      url: 'https://app.test/api/orders',
      params: [{ name: 'orderId', type: 'string' }],
    })
    const prims = [primitive('idorSwapper', ['idor', 'authz'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice).toBeDefined()
    expect(slice!.reason).toContain('signals: object-id-param')
    expect(slice!.priority).toBeGreaterThanOrEqual(4)
  })
})
