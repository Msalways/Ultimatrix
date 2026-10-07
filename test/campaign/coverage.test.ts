import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { __setTestFallback } from '../../src/runtime/engagement-context'
import { NodeType } from '../../src/graph/schema'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { SessionManager } from '../../src/http/session-manager'
import { CapturedRequestStore } from '../../src/capture/captured-request-store'
import { planCampaign } from '../../src/campaign/planner'
import { runCampaign } from '../../src/campaign/executor'
import { createPrimitiveRunner } from '../../src/campaign/runner'
import type { CampaignPlan, CampaignSlice, PlanOptions, PrimitiveRef } from '../../src/campaign/types'
import { registerPrimitive } from '../../src/primitives/framework'
import { TargetTransportGovernor } from '../../src/runtime/target-governor'
import { writeFinding } from '../../src/tools/control-tools'
import { listPrimitiveMetadata } from '../../src/primitives'

// Importing the primitive registry installs the runtime implementations.
void listPrimitiveMetadata()

function endpoint(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'ep:fixture',
    type: NodeType.ENDPOINT,
    label: 'Fixture endpoint',
    properties: {
      url: 'https://app.test/api/items?search=old',
      method: 'POST',
      params: [
        { name: 'search', type: 'string', in: 'query' },
        { name: 'title', type: 'string', in: 'body' },
      ],
      headers: { 'X-Org': 'blue' },
      ...overrides,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function memoryGraph(endpoints: any[] = [endpoint()]): any {
  const nodes = new Map<string, any>(endpoints.map(node => [node.id, node]))
  return {
    queryNodes: (type?: string) => [...nodes.values()].filter(node => !type || node.type === type),
    getNode: (id: string) => nodes.get(id),
    upsertNode: (node: any) => { nodes.set(node.id, node); return node },
    save: async () => {},
    getAllEdges: () => [],
  }
}

const config: any = {
  provider: 'test',
  campaign: { maxRequests: 1, maxDurationMs: 10_000, maxConcurrency: 1 },
  rateLimit: { requestsPerMinute: 1000, maxConcurrent: 1, retryOnLimit: false, maxRetries: 0 },
}

function testServices(overrides: Record<string, unknown> = {}): any {
  return {
    providerLimiters: new Map(),
    httpSessions: new SessionManager(),
    capturedRequests: new CapturedRequestStore(),
    findingState: { evidenceBuffer: new Map(), evidenceGate: null },
    interactionBroker: { isActive: () => true, request: async () => 'yes' },
    scopeConfig: null,
    campaignRequestBudget: undefined,
    ...overrides,
  }
}

function makePlan(store: any, primitives: PrimitiveRef[], domainNames = ['fixture'], extra: Partial<PlanOptions> = {}): CampaignPlan {
  return planCampaign(store, { primitives, domainNames, ...extra })
}

describe('campaign input coverage and resume', () => {
  beforeEach(() => __setTestFallback(testServices()))
  afterEach(() => __setTestFallback(null))

  it('plans query, body, and custom-header inputs as distinct single-input units', () => {
    const store = memoryGraph()
    const plan = makePlan(store, [{ id: 'injection', tags: ['sqli'], domains: ['fixture'] }])
    const slices = plan.slices.filter(slice => slice.endpoint.id === 'ep:fixture')
    expect(slices.map(slice => `${slice.input?.location}:${slice.input?.name}`).sort()).toEqual([
      'body:title', 'header:X-Org', 'query:search',
    ])
    expect(slices.every(slice => slice.params.length <= 1 && slice.techniqueIds.length === 1)).toBe(true)
    expect(plan.coverage.paramsTotal).toBe(3)
    expect(plan.coverage.paramsCovered).toBe(3)
  })

  it('preserves actor-specific units instead of folding roles together', () => {
    const ep = endpoint({
      authRequired: true,
      params: [{ name: 'recordId', type: 'string', in: 'query' }],
      headers: {},
    })
    const store = memoryGraph([ep])
    const plan = makePlan(store, [{ id: 'authzMatrix', tags: ['authz'], domains: ['auth'] }], ['auth'])
    expect(plan.slices.map(slice => slice.actor)).toEqual(expect.arrayContaining(['authenticated']))
    expect(plan.slices.every(slice => slice.input?.name === 'recordId')).toBe(true)
  })

  it('expands authenticated roles into named session actors', () => {
    const ep = endpoint({ authRequired: true, params: [{ name: 'recordId', type: 'string', in: 'query' }], headers: {} })
    const store = memoryGraph([ep])
    const plan = makePlan(store, [{ id: 'authzMatrix', tags: ['authz'], domains: ['auth'] }], ['auth'], {
      actorSessions: { authenticated: ['guest', 'victim'] },
    })
    expect(plan.slices.map(slice => slice.sessionRef)).toEqual(expect.arrayContaining(['guest', 'victim']))
    expect(new Set(plan.slices.map(slice => slice.id)).size).toBe(plan.slices.length)
    expect(plan.coverage.actorsTotal).toBe(2)
    expect(plan.coverage.actorsCovered).toBe(2)
  })

  it('reports capped work as partial and resumes without repeating completed units', async () => {
    const store = memoryGraph()
    const plan = makePlan(store, [{ id: 'probe', tags: ['injection'], domains: ['fixture'] }])
    const calls: string[] = []
    const deps = {
      graphStore: store,
      config,
      maxRequests: 1,
      maxConcurrency: 1,
      executor: async (primitiveId: string, slice: CampaignSlice, ctx: any) => {
        calls.push(slice.id)
        if (!ctx.consumeRequest()) return { primitiveId, confirmed: false, coverageStatus: 'blocked', description: 'campaign request cap reached' }
        return { primitiveId, confirmed: false, coverageStatus: 'tested', description: 'fixture request completed' }
      },
    }
    const first = await runCampaign(plan, deps)
    expect(first.status).toBe('partial')
    expect(first.requestsUsed).toBe(1)
    expect(first.remainingSlices.length).toBe(2)

    const second = await runCampaign(plan, deps)
    expect(second.status).toBe('partial')
    expect(second.requestsUsed).toBe(1)
    expect(new Set(calls).size).toBe(calls.length)
    expect(second.remainingSlices.length).toBe(1)
  })

  it('stops remaining slices when the shared engagement wire budget is exhausted', async () => {
    const store = memoryGraph()
    const plan = makePlan(store, [
      { id: 'probe-a', tags: ['injection'], domains: ['fixture'] },
      { id: 'probe-b', tags: ['injection'], domains: ['fixture'] },
    ])
    const calls: string[] = []
    const result = await runCampaign(plan, {
      graphStore: store,
      config,
      maxRequests: 100,
      maxConcurrency: 1,
      executor: async (primitiveId, slice, ctx) => {
        calls.push(slice.id)
        ctx.onTargetBudgetReached?.()
        return { primitiveId, confirmed: false, coverageStatus: 'blocked', description: 'Target request budget reached' }
      },
    })
    expect(calls).toHaveLength(1)
    expect(result.status).toBe('partial')
    expect(result.budgetExceeded).toBe(true)
    expect(result.remainingSlices).toHaveLength(plan.slices.length)
  })

  it('stops remaining slices when an exact URL reaches its repeated-request cap', async () => {
    const url = 'http://127.0.0.1:49127/api/items?search=old'
    const capturedRequests = new CapturedRequestStore()
    capturedRequests.record({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: '{"title":"old"}' })
    const targetGovernor = new TargetTransportGovernor({ requestsPerMinute: 1000, maxConcurrent: 1, maxRequests: 100, maxRequestsPerUrl: 1 })
    __setTestFallback(testServices({ capturedRequests, targetGovernor }))
    ;(await targetGovernor.acquire(url, 'http-tool'))()

    registerPrimitive({
      id: 'repeatedBudgetRegressionProbe',
      name: 'repeated budget regression probe',
      description: 'test repeated-request budget handling',
      appliesTo: () => true,
      generate: async (context: any) => [{
        id: 'same-route-step',
        description: 'repeat the captured route',
        request: context.requestTemplate,
      }],
      oracle: async () => ({ confirmed: false, confidence: 0, evidence: [] }),
    } as any)

    const store = memoryGraph([endpoint({ url, method: 'POST', params: [], headers: { 'content-type': 'application/json' } })])
    const planned = makePlan(store, [])
    const templateSlice: CampaignSlice = {
      id: 'repeat-budget-0',
      endpoint: { id: 'ep:fixture', url, method: 'POST' },
      params: [],
      role: 'anonymous',
      state: 'baseline',
      techniqueIds: ['repeatedBudgetRegressionProbe'],
      priority: 1,
    }
    planned.slices = [0, 1].map(index => ({ ...templateSlice, id: `repeat-budget-${index}` }))
    planned.coverage.slicesPlanned = planned.slices.length
    const result = await runCampaign(planned, {
      graphStore: store,
      config,
      maxRequests: 100,
      maxConcurrency: 1,
      executor: createPrimitiveRunner(store, config, new EvidenceGate()),
    })

    expect(result.coverage.slicesExecuted).toBe(1)
    expect(result.budgetExceeded).toBe(true)
    expect(result.remainingSlices).toHaveLength(2)
  })

  it('retests a fully completed plan on a later campaign run', async () => {
    const store = memoryGraph()
    const plan = makePlan(store, [{ id: 'probe', tags: ['injection'], domains: ['fixture'] }])
    const calls: string[] = []
    const options = {
      graphStore: store,
      config,
      maxRequests: 100,
      maxConcurrency: 1,
      executor: async (primitiveId: string, slice: CampaignSlice, ctx: any) => {
        calls.push(slice.id)
        expect(ctx.consumeRequest()).toBe(true)
        return { primitiveId, confirmed: false, coverageStatus: 'tested' as const }
      },
    }
    expect((await runCampaign(plan, options)).status).toBe('complete')
    expect((await runCampaign(plan, options)).status).toBe('complete')
    expect(calls).toHaveLength(plan.slices.length * 2)
    expect(new Set(calls.slice(0, plan.slices.length))).toEqual(new Set(calls.slice(plan.slices.length)))
  })

  it('serializes slices that may share application state or actor sessions', async () => {
    const store = memoryGraph()
    const plan = makePlan(store, [{ id: 'probe', tags: ['injection'], domains: ['fixture'] }])
    let active = 0
    let peakActive = 0
    const result = await runCampaign(plan, {
      graphStore: store,
      config: { ...config, campaign: { ...config.campaign, maxConcurrency: 4 }, rateLimit: { ...config.rateLimit, maxConcurrent: 4 } },
      maxConcurrency: 4,
      maxRequests: 10,
      executor: async (primitiveId, _slice, context) => {
        active++
        peakActive = Math.max(peakActive, active)
        try {
          expect(context.consumeRequest()).toBe(true)
          await new Promise(resolve => setTimeout(resolve, 2))
          return { primitiveId, confirmed: false, coverageStatus: 'tested' }
        } finally {
          active--
        }
      },
    })
    expect(result.status).toBe('complete')
    expect(peakActive).toBe(1)
  })

  it('keeps positive primitive signals as candidates when proven experiment and retest are missing', async () => {
    const store = memoryGraph()
    const plan = makePlan(store, [{ id: 'positive', tags: ['injection'], domains: ['fixture'] }])
    const writeSpy = vi.spyOn(writeFinding, 'execute').mockResolvedValue({
      ok: false,
      error: 'Finding promotion requires at least one proven experiment.',
    } as any)
    try {
      const result = await runCampaign(plan, {
        graphStore: store,
        config,
        maxConcurrency: 1,
        executor: async primitiveId => ({
          primitiveId,
          confirmed: true,
          confidence: 0.95,
          evidence: [
            { type: 'raw_request', data: 'GET /api/items?q=probe', label: 'captured request', timestamp: Date.now() },
            { type: 'raw_response', data: 'positive marker', label: 'captured response', timestamp: Date.now() },
          ],
          description: 'primitive signal requires an independent replay and retest',
        }),
      })
      expect(result.status).toBe('partial')
      expect(result.units.every(unit => unit.status === 'candidate')).toBe(true)
      expect(result.findings).toHaveLength(0)
      expect(writeSpy).toHaveBeenCalled()
      expect(writeSpy.mock.calls[0][0]).not.toHaveProperty('experimentIds')
    } finally {
      writeSpy.mockRestore()
    }
  })
})

describe('campaign prerequisites', () => {
  beforeEach(() => __setTestFallback(testServices()))
  afterEach(() => __setTestFallback(null))

  it('reports missing captured authentication instead of counting the unit as tested', async () => {
    const store = memoryGraph([endpoint({ authRequired: true, params: [{ name: 'recordId', type: 'string', in: 'query' }], headers: {} })])
    const captureStore = new CapturedRequestStore()
    captureStore.record({ method: 'POST', url: 'https://app.test/api/items?recordId=1', headers: {} })
    __setTestFallback(testServices({ capturedRequests: captureStore }))
    const runner = createPrimitiveRunner(store, config, new EvidenceGate())
    const slice: CampaignSlice = {
      id: 'auth-unit', endpoint: { id: 'ep:fixture', url: 'https://app.test/api/items?recordId=1', method: 'POST' },
      input: { name: 'recordId', location: 'query' }, params: ['recordId'], role: 'authenticated', actor: 'authenticated',
      state: 'baseline', techniqueIds: ['idorSwapper'], priority: 1,
    }
    const result = await runner('idorSwapper', slice, { slice, graphStore: store, config, provider: 'test' })
    expect(result.coverageStatus).toBe('blocked')
    expect(result.description).toContain('missing credentials')
  })

  it('requires a second independent actor for cross-user primitives', async () => {
    const store = memoryGraph([endpoint({ authRequired: true, params: [{ name: 'recordId', type: 'string', in: 'query' }], headers: {} })])
    const captureStore = new CapturedRequestStore()
    captureStore.record({ method: 'POST', url: 'https://app.test/api/items?recordId=1', headers: { Authorization: 'Bearer owner' } })
    __setTestFallback(testServices({ capturedRequests: captureStore }))
    const runner = createPrimitiveRunner(store, config, new EvidenceGate())
    const slice: CampaignSlice = {
      id: 'idor-unit', endpoint: { id: 'ep:fixture', url: 'https://app.test/api/items?recordId=1', method: 'POST' },
      input: { name: 'recordId', location: 'query' }, params: ['recordId'], role: 'authenticated', actor: 'owner',
      state: 'baseline', techniqueIds: ['idorSwapper'], priority: 1,
    }
    const result = await runner('idorSwapper', slice, { slice, graphStore: store, config, provider: 'test' })
    expect(result.coverageStatus).toBe('blocked')
    expect(result.description).toContain('second authenticated actor')
  })

  it('recognizes a captured custom session header as an authenticated campaign actor', async () => {
    let observed: any
    registerPrimitive({
      id: 'customSessionActorProbe',
      name: 'custom session actor probe',
      description: 'test-only custom session context probe',
      appliesTo: () => true,
      generate: async (context: any) => {
        observed = { sessionHeaders: context.sessionHeaders, requestHeaders: context.requestTemplate.headers }
        return []
      },
      oracle: async () => ({ confirmed: false, confidence: 0, evidence: [], note: 'no request required' }),
    } as any)
    const store = memoryGraph([endpoint({ authRequired: true, params: [], headers: {} })])
    const captureStore = new CapturedRequestStore()
    captureStore.record({
      method: 'POST', url: 'https://app.test/api/items?search=old',
      headers: { 'X-Session-ID': 'actor-a', 'Content-Type': 'application/json' },
    })
    __setTestFallback(testServices({ capturedRequests: captureStore }))
    const runner = createPrimitiveRunner(store, config, new EvidenceGate())
    const slice: CampaignSlice = {
      id: 'custom-session-unit',
      endpoint: { id: 'ep:fixture', url: 'https://app.test/api/items?search=old', method: 'POST' },
      input: { name: '', location: 'endpoint' }, params: [], role: 'authenticated', actor: 'captured actor',
      state: 'baseline', techniqueIds: ['customSessionActorProbe'], priority: 1,
    }

    const result = await runner('customSessionActorProbe', slice, { slice, graphStore: store, config, provider: 'test' })

    expect(result.coverageStatus).toBe('tested')
    expect(observed.sessionHeaders).toHaveProperty('X-Session-ID', 'actor-a')
    expect(observed.requestHeaders).toHaveProperty('X-Session-ID', 'actor-a')
  })

  it('removes captured credentials from anonymous actor coverage', async () => {
    let observedHeaders: Record<string, string> | undefined
    registerPrimitive({
      id: 'anonymousActorCoverageProbe',
      name: 'anonymous actor coverage probe',
      description: 'test-only context probe',
      appliesTo: () => true,
      generate: async (ctx: any) => { observedHeaders = ctx.requestTemplate.headers; return [] },
      oracle: async () => ({ confirmed: false, confidence: 0, evidence: [], note: 'no request required' }),
    } as any)
    const store = memoryGraph([endpoint({ authRequired: false, params: [{ name: 'search', type: 'string', in: 'query' }] })])
    const captureStore = new CapturedRequestStore()
    captureStore.record({
      method: 'POST',
      url: 'https://app.test/api/items?search=old',
      headers: {
        Authorization: 'Bearer private', Cookie: 'sid=private', 'X-Session-ID': 'private-session',
        'X-CSRF-Token': 'private', 'X-Trace': 'kept',
      },
    })
    __setTestFallback(testServices({ capturedRequests: captureStore }))
    const runner = createPrimitiveRunner(store, config, new EvidenceGate())
    const slice: CampaignSlice = {
      id: 'anonymous-unit',
      endpoint: { id: 'ep:fixture', url: 'https://app.test/api/items?search=old', method: 'POST' },
      input: { name: 'search', location: 'query' }, params: ['search'], role: 'anonymous', actor: 'anonymous',
      state: 'baseline', techniqueIds: ['anonymousActorCoverageProbe'], priority: 1,
    }
    const result = await runner('anonymousActorCoverageProbe', slice, { slice, graphStore: store, config, provider: 'test' })
    expect(result.coverageStatus).toBe('tested')
    expect(observedHeaders).toEqual({ 'X-Trace': 'kept' })
  })

  it('passes a browser-observed workflow sequence and terminal capture to the primitive', async () => {
    let observed: any
    registerPrimitive({
      id: 'workflowContextProbe',
      name: 'workflow context probe',
      description: 'test-only workflow context probe',
      appliesTo: () => true,
      generate: async (context: any) => {
        observed = {
          workflowSteps: context.workflowSteps,
          requestTemplate: context.requestTemplate,
          capturedRequestId: context.capturedRequestId,
        }
        return []
      },
      oracle: async () => ({ confirmed: false, candidate: true, confidence: 0.5, evidence: [], note: 'fresh actor verification required' }),
    } as any)
    const store = memoryGraph([
      endpoint({ params: [], headers: {} }),
      {
        id: 'wf:browser', type: NodeType.WORKFLOW,
        properties: {
          source: 'browser-observation', sequenceObserved: true,
          capturedRequestIds: ['cap-1', 'cap-2'],
          steps: [
            { action: 'GET items', endpointId: 'ep:fixture', method: 'GET', url: 'https://app.test/api/items', requestId: 'cap-1' },
            { action: 'POST item', endpointId: 'ep:fixture', method: 'POST', url: 'https://app.test/api/items', requestId: 'cap-2' },
          ],
        },
      },
    ])
    const captureStore = new CapturedRequestStore()
    captureStore.record({ method: 'POST', url: 'https://app.test/api/items?search=old', headers: { 'Content-Type': 'application/json' }, body: '{"title":"workflow-terminal"}' })
    captureStore.record({ method: 'POST', url: 'https://app.test/api/items?search=old', headers: { 'Content-Type': 'application/json' }, body: '{"title":"later-unrelated-request"}' })
    __setTestFallback(testServices({ capturedRequests: captureStore }))
    const runner = createPrimitiveRunner(store, config, new EvidenceGate())
    const slice: CampaignSlice = {
      id: 'workflow-unit',
      endpoint: { id: 'ep:fixture', url: 'https://app.test/api/items?search=old', method: 'POST' },
      input: { name: '', location: 'endpoint' }, params: [], role: 'anonymous', actor: 'anonymous',
      state: 'baseline', workflowId: 'wf:browser', workflowSteps: ['POST /draft', 'POST /finish'],
      workflowTerminalRequestId: 'cap-1',
      techniqueIds: ['workflowContextProbe'], priority: 1,
    }

    const result = await runner('workflowContextProbe', slice, { slice, graphStore: store, config, provider: 'test' })
    expect(result.coverageStatus).toBe('candidate')
    expect(observed.workflowSteps).toEqual(['POST /draft', 'POST /finish'])
    expect(observed.requestTemplate).toMatchObject({ method: 'POST', body: '{"title":"workflow-terminal"}' })
    expect(observed.capturedRequestId).toBe('cap-1')
  })

  it('blocks workflow replay when the graph has no request-backed operator trace', async () => {
    const store = memoryGraph([endpoint({ params: [], headers: {} })])
    const captureStore = new CapturedRequestStore()
    captureStore.record({ method: 'POST', url: 'https://app.test/api/items?search=old' })
    __setTestFallback(testServices({ capturedRequests: captureStore }))
    const runner = createPrimitiveRunner(store, config, new EvidenceGate())
    const slice: CampaignSlice = {
      id: 'unobserved-workflow-unit',
      endpoint: { id: 'ep:fixture', url: 'https://app.test/api/items?search=old', method: 'POST' },
      input: { name: '', location: 'endpoint' }, params: [], role: 'anonymous', actor: 'anonymous',
      state: 'baseline', workflowId: 'wf:missing', workflowSteps: ['POST /draft', 'POST /finish'],
      workflowTerminalRequestId: 'cap-1', techniqueIds: ['workflowBypass'], priority: 1,
    }

    const result = await runner('workflowBypass', slice, { slice, graphStore: store, config, provider: 'test' })

    expect(result.coverageStatus).toBe('blocked')
    expect(result.description).toContain('request-backed observed workflow')
  })

  it('reports an out-of-scope endpoint as blocked before attempting HTTP', async () => {
    const store = memoryGraph([endpoint({ url: 'https://outside.test/api/items?search=old' })])
    __setTestFallback(testServices({ scopeConfig: { allowedDomains: ['app.test'], enforcement: 'hard' } }))
    const runner = createPrimitiveRunner(store, config, new EvidenceGate())
    const slice: CampaignSlice = {
      id: 'scope-unit', endpoint: { id: 'ep:fixture', url: 'https://outside.test/api/items?search=old', method: 'POST' },
      input: { name: 'search', location: 'query' }, params: ['search'], role: 'anonymous', actor: 'anonymous',
      state: 'baseline', techniqueIds: ['classicInjection'], priority: 1,
    }
    const result = await runner('classicInjection', slice, { slice, graphStore: store, config, provider: 'test' })
    expect(result.coverageStatus).toBe('blocked')
    expect(result.description).toContain('scope denied')
  })
})

describe('campaign captured-input request binding', () => {
  beforeEach(() => __setTestFallback(testServices()))
  afterEach(() => __setTestFallback(null))

  it.each([
    { location: 'query', name: 'search' },
    { location: 'body', name: 'title' },
    { location: 'header', name: 'X-Org' },
  ])('mutates only the captured $location input ($name)', async input => {
    const received: Array<{ method: string; url: string; headers: IncomingMessage['headers']; body: string }> = []
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        received.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
        response.statusCode = 200
        response.end('accepted')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/api/items?search=old&keep=query`
    const headers = { 'content-type': 'application/json', 'X-Org': 'blue', 'X-Trace': 'preserve' }
    const body = JSON.stringify({ title: 'old', keep: 'body' })
    const capturedRequests = new CapturedRequestStore()
    capturedRequests.record({ method: 'POST', url, headers, body })
    __setTestFallback(testServices({ capturedRequests }))
    const graph = memoryGraph([endpoint({ url, method: 'POST', headers })])
    const primitiveId = `campaignInputBinding-${input.location}`
    registerPrimitive({
      id: primitiveId,
      name: 'campaign input binding fixture',
      description: 'Test the real campaign HTTP request seam for one declared input.',
      appliesTo: () => true,
      generate: async (context: any) => {
        const template = context.requestTemplate
        const mutatedUrl = new URL(template.url)
        const mutatedHeaders = { ...template.headers }
        let mutatedBody = template.body
        if (input.location === 'query') mutatedUrl.searchParams.set(input.name, 'query-marker')
        if (input.location === 'body') mutatedBody = JSON.stringify({ ...JSON.parse(template.body), [input.name]: 'body-marker' })
        if (input.location === 'header') mutatedHeaders[input.name] = 'header-marker'
        return [{
          id: 'one-input-step',
          description: `mutate ${input.location}:${input.name}`,
          request: { method: template.method, url: mutatedUrl.toString(), headers: mutatedHeaders, body: mutatedBody },
        }]
      },
      oracle: async () => ({ confirmed: false, confidence: 0, evidence: [], note: 'fixture request completed' }),
    } as any)

    try {
      const runner = createPrimitiveRunner(graph, config, new EvidenceGate())
      const slice: CampaignSlice = {
        id: `input-binding:${input.location}`,
        endpoint: { id: 'ep:fixture', url, method: 'POST' },
        input: { name: input.name, location: input.location },
        params: [input.name], role: 'anonymous', actor: 'anonymous', state: 'baseline',
        techniqueIds: [primitiveId], priority: 1,
      }
      const result = await runner(primitiveId, slice, { slice, graphStore: graph, config, provider: 'test' })
      expect(result.coverageStatus).toBe('tested')
      const targetRequests = received.filter(item => new URL(item.url, url).pathname === '/api/items')
      expect(targetRequests).toHaveLength(1)
      const request = targetRequests[0]
      const requestUrl = new URL(request.url, url)
      expect(request.method).toBe('POST')
      expect(requestUrl.searchParams.get('keep')).toBe('query')
      expect(request.headers['x-trace']).toBe('preserve')
      expect(requestUrl.searchParams.get('search')).toBe(input.location === 'query' ? 'query-marker' : 'old')
      expect(JSON.parse(request.body)).toEqual({ title: input.location === 'body' ? 'body-marker' : 'old', keep: 'body' })
      expect(request.headers['x-org']).toBe(input.location === 'header' ? 'header-marker' : 'blue')
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
