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

function store(eps: any[], edges: any[] = [], hypotheses: any[] = [], workflows: any[] = []) {
  return {
    queryNodes: (type: string) => {
      if (type === 'Endpoint') return eps
      if (type === 'Hypothesis') return hypotheses
      if (type === 'Workflow') return workflows
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
    const slices = plan.slices.filter((s) => s.endpoint.id === 'ep1')
    expect(slices.length).toBeGreaterThan(0)
    expect(slices.flatMap(s => s.techniqueIds)).toContain('ssrfOast')
    expect(slices.find(s => s.techniqueIds.includes('ssrfOast'))?.reason).toContain('signals: url-like-param')
    // base(hasParams) 1 + signalBoost 3
    expect(slices.find(s => s.techniqueIds.includes('ssrfOast'))!.priority).toBeGreaterThanOrEqual(4)
  })

  it('routes graphql endpoints to graphql-tagged primitives even without params', () => {
    const ep = endpoint({ url: 'https://app.test/graphql', method: 'POST', params: [] })
    const prims = [primitive('graphqlBola', ['graphql', 'bola']), primitive('classicInjection', ['sqli'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slices = plan.slices.filter((s) => s.endpoint.id === 'ep1')
    expect(slices.flatMap(s => s.techniqueIds)).toContain('graphqlBola')
    expect(slices.find(s => s.techniqueIds.includes('graphqlBola'))?.reason).toContain('graphql')
    // state-changing 0 + graphql boost 3
    expect(slices.find(s => s.techniqueIds.includes('graphqlBola'))!.priority).toBeGreaterThanOrEqual(3)
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
    const slices = plan.slices.filter((s) => s.endpoint.id === 'ep1')
    expect(slices.map(s => s.role)).toContain('authenticated')
    expect(slices.flatMap(s => s.techniqueIds)).toEqual(expect.arrayContaining(['authzMatrix', 'idorSwapper']))
    // authenticated 2 + object-id signal boost 3 + hasParams 1
    expect(slices.find(s => s.techniqueIds.includes('idorSwapper'))!.priority).toBeGreaterThanOrEqual(6)
  })

  it('prioritizes endpoint units targeted by learned workflow hypotheses', () => {
    const ep = endpoint({
      method: 'POST',
      params: [{ name: 'orderId', type: 'string' }],
    })
    const workflowHypothesis = {
      id: 'hypothesis-workflow-bypass',
      type: 'Hypothesis',
      properties: {
        kind: 'workflow_bypass',
        targetEndpoints: ['ep1'],
        status: 'open',
      },
    }
    const plan = planCampaign(
      store([ep], [], [workflowHypothesis]),
      { primitives: [primitive('stateProbe', ['state-changing'])] },
    )
    const slice = plan.slices.find(s => s.endpoint.id === 'ep1')

    expect(slice?.reason).toContain('Research hypotheses target this endpoint (1)')
    expect(slice?.priority).toBeGreaterThanOrEqual(4)
  })

  it('routes workflow bypass only to the observed terminal state change and carries ordered steps', () => {
    const start = { ...endpoint({ url: 'https://app.test/a1', method: 'POST', params: [{ name: 'draft', type: 'string' }] }), id: 'start' }
    const finish = { ...endpoint({ url: 'https://app.test/b7', method: 'POST', params: [{ name: 'order', type: 'string' }] }), id: 'finish' }
    const workflow = {
      id: 'wf:observed-1',
      type: 'Workflow',
      properties: {
        steps: [
          { action: 'request', endpointId: 'start', method: 'POST', url: 'https://app.test/a1', requestId: 'cap-start' },
          { action: 'request', endpointId: 'finish', method: 'POST', url: 'https://app.test/b7', requestId: 'cap-finish' },
        ],
        relatedEndpoints: ['start', 'finish'],
        capturedRequestIds: ['cap-start', 'cap-finish'],
        source: 'operator-demonstration',
        sequenceObserved: true,
        capturedAt: 10,
      },
    }
    const plan = planCampaign(
      store([start, finish], [], [], [workflow]),
      { primitives: [primitive('workflowBypass', ['workflow', 'business'])] },
    )
    const bypassSlices = plan.slices.filter(slice => slice.techniqueIds.includes('workflowBypass'))

    expect(bypassSlices).toHaveLength(1)
    expect(bypassSlices[0]?.endpoint.id).toBe('finish')
    expect(bypassSlices[0]?.input).toEqual({ name: '', location: 'endpoint' })
    expect(bypassSlices[0]?.workflowId).toBe('wf:observed-1')
    expect(bypassSlices[0]?.workflowSteps).toEqual(['POST /a1', 'POST /b7'])
    expect(bypassSlices[0]?.workflowTerminalRequestId).toBe('cap-finish')
    expect(bypassSlices[0]?.reason).toContain('observed workflow wf:observed-1')
  })

  it('does not schedule workflow replay from inferred or unbacked workflow sequences', () => {
    const start = { ...endpoint({ url: 'https://app.test/a1', method: 'POST' }), id: 'start' }
    const finish = { ...endpoint({ url: 'https://app.test/b7', method: 'POST' }), id: 'finish' }
    const base = {
      steps: [
        { action: 'request', endpointId: 'start', method: 'POST', url: 'https://app.test/a1', requestId: 'cap-start' },
        { action: 'request', endpointId: 'finish', method: 'POST', url: 'https://app.test/b7', requestId: 'cap-finish' },
      ],
      relatedEndpoints: ['start', 'finish'],
      capturedRequestIds: ['cap-start', 'cap-finish'],
    }
    const workflows = [
      { id: 'wf:inferred', type: 'Workflow', properties: { ...base, source: 'endpoint-inference', sequenceObserved: false } },
      { id: 'wf:unobserved', type: 'Workflow', properties: { ...base, source: 'operator-demonstration', sequenceObserved: false } },
      { id: 'wf:missing-requests', type: 'Workflow', properties: { ...base, source: 'operator-demonstration', sequenceObserved: true, capturedRequestIds: [] } },
    ]
    const plan = planCampaign(
      store([start, finish], [], [], workflows),
      { primitives: [primitive('workflowBypass', ['workflow', 'business'])] },
    )

    expect(plan.slices.some(slice => slice.techniqueIds.includes('workflowBypass'))).toBe(false)
  })

  it('does not infer a workflow from a state-changing method alone', () => {
    const ep = endpoint({ method: 'POST', params: [{ name: 'value', type: 'string' }] })
    const plan = planCampaign(store([ep]), { primitives: [primitive('workflowBypass', ['workflow', 'business'])] })
    expect(plan.slices.some(slice => slice.techniqueIds.includes('workflowBypass'))).toBe(false)
  })

  it('keeps generic recon techniques relevant to any endpoint', () => {
    const ep = endpoint({ url: 'https://app.test/robots.txt' })
    const prims = [primitive('recon', ['recon', 'info-disclosure'])]
    const plan = planCampaign(store([ep]), { primitives: prims })
    const slice = plan.slices.find((s) => s.endpoint.id === 'ep1')
    expect(slice).toBeDefined()
    expect(slice!.techniqueIds).toContain('recon')
  })

  it('does not schedule transport assets, unresolved client templates, or an inputless root page', () => {
    const eps = [
      endpoint({ url: 'https://app.test/scripts.js' }),
      endpoint({ id: 'root', url: 'https://app.test/' }),
      endpoint({ id: 'template', url: 'https://app.test/$%7Bgt(r.root,!0)%7D' }),
      endpoint({ id: 'search', url: 'https://app.test/rest/products/search', params: [{ name: 'q', type: 'query', in: 'query' }] }),
    ].map((ep, index) => ({ ...ep, id: ['script', 'root', 'template', 'search'][index] }))
    const plan = planCampaign(store(eps), { primitives: [primitive('recon', ['recon']), primitive('sqli', ['sqli'])] })
    expect(plan.slices.map(slice => slice.endpoint.id)).toEqual(expect.arrayContaining(['search']))
    expect(plan.slices.some(slice => ['ep1', 'root', 'template'].includes(slice.endpoint.id))).toBe(false)
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
