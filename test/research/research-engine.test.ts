import { describe, expect, it } from 'vitest'
import { GraphStore } from '../../src/graph/store'
import { extractWorkflows } from '../../src/research/workflow-extractor'
import { extractEntities } from '../../src/research/entity-extractor'
import { generateHypotheses } from '../../src/research/hypothesis-engine'
import { planExperiments } from '../../src/research/experiment-planner'
import { compareResearchResponses } from '../../src/research/differential'
import { candidateFromExperiment } from '../../src/research/candidate-store'
import { isTransportOrAssetUrl } from '../../src/research/utils'
import { NodeType, type EndpointNode, type WorkflowNode } from '../../src/graph/schema'

function seededStore(): GraphStore {
  const store = new GraphStore('test-output/research-graph.json')
  store.addEndpoint({
    method: 'GET',
    url: 'https://app.test/api/projects/123',
    params: [{ name: 'id', type: 'string', in: 'path' }],
    authRequired: true,
    headers: { authorization: 'Bearer token-a' },
    source: 'test',
  })
  store.addEndpoint({
    method: 'PATCH',
    url: 'https://app.test/api/orgs/777/members/123',
    params: [
      { name: 'role', type: 'string', in: 'body' },
      { name: 'userId', type: 'string', in: 'body' },
    ],
    authRequired: true,
    source: 'test',
  })
  return store
}

describe('research engine', () => {
  it('extracts workflows and entities from graph endpoints', () => {
    const store = seededStore()
    const workflows = extractWorkflows(store)
    const entities = extractEntities(store)

    expect(workflows.length).toBeGreaterThan(0)
    expect(entities.map(e => e.name)).toContain('Projects')
    expect(entities.some(e => e.roleFields.includes('role'))).toBe(true)
  })

  it('generates hypotheses and plans experiments', () => {
    const store = seededStore()
    const workflows = extractWorkflows(store)
    const entities = extractEntities(store)
    const hypotheses = generateHypotheses(store, workflows, entities)
    const experiments = planExperiments(store, hypotheses)

    expect(hypotheses.some(h => h.kind === 'idor')).toBe(true)
    expect(hypotheses.some(h => h.kind === 'mass_assignment')).toBe(true)
    expect(experiments.some(e => e.requiredActors.includes('actor-b'))).toBe(true)
  })

  it('compares responses and creates a candidate from interesting differentials', () => {
    const store = seededStore()
    const hypothesis = generateHypotheses(store, extractWorkflows(store), extractEntities(store))[0]
    const experiment = planExperiments(store, [hypothesis])[0]
    const differential = compareResearchResponses(
      { status: 403, body: '{"error":"forbidden"}' },
      { status: 200, body: '{"email":"victim@app.test","role":"owner"}' },
      { jsonFields: ['email', 'role'] },
    )
    const candidate = candidateFromExperiment(experiment, differential)

    expect(differential.interesting).toBe(true)
    expect(differential.authorizationMismatch).toBe(true)
    expect(candidate.severity).toBe('high')
    expect(candidate.nextVerificationSteps.length).toBeGreaterThan(0)
  })

  it('keeps a generic allowed response inconclusive without a declared observable', () => {
    const differential = compareResearchResponses(
      { status: 403, body: '{"error":"forbidden"}' },
      { status: 200, body: '{"message":"ok"}' },
    )
    expect(differential.interesting).toBe(false)
    expect(differential.authorizationMismatch).toBe(false)
  })

  it('creates a SQLi research task only from a captured query-input route', () => {
    const store = new GraphStore('test-output/sqli-graph.json')
    store.addEndpoint({
      method: 'GET',
      url: 'https://app.test/rest/products/search',
      params: [{ name: 'q', type: 'query', in: 'query' }],
      tags: ['har-capture'],
      source: 'har-bridge',
    })
    const hypotheses = generateHypotheses(store, [], [])
    const hypothesis = hypotheses.find(item => item.kind === 'sql_injection')
    expect(hypothesis).toMatchObject({ targetParams: ['q'], requiredSetup: expect.arrayContaining(['Capture a non-empty benign input through the target UI']) })
    expect(planExperiments(store, [hypothesis!])[0]).toMatchObject({
      title: 'Compare observed search input with a bounded boolean SQL expression',
      baselineRequest: { method: 'GET', url: 'https://app.test/rest/products/search' },
      status: 'planned',
    })
  })
})

describe('extraction noise gates (transport/asset URLs are not behavior)', () => {
  const ep = (id: string, url: string, method = 'GET'): EndpointNode => ({
    id,
    type: NodeType.ENDPOINT,
    properties: { url, method, params: [], tags: [], source: 'har-bridge' },
  })
  const mockStore = (endpoints: EndpointNode[], workflows: WorkflowNode[] = []) => ({
    queryNodes: (type: any) => type === NodeType.ENDPOINT ? endpoints : type === NodeType.WORKFLOW ? workflows : [],
  }) as any

  it('isTransportOrAssetUrl flags infrastructure without target keywords', () => {
    expect(isTransportOrAssetUrl('https://app.test/favicon.ico')).toBe(true)
    expect(isTransportOrAssetUrl('https://app.test/static/app.js')).toBe(true)
    expect(isTransportOrAssetUrl('https://app.test/socket.io/', 'POST')).toBe(true)
    expect(isTransportOrAssetUrl('https://app.test/$%7Bgt(r.root,!0)%7D', 'GET')).toBe(true)
    expect(isTransportOrAssetUrl('https://app.test/rest/admin/health')).toBe(true)
    expect(isTransportOrAssetUrl('https://app.test/api/orders/12345')).toBe(false)
    expect(isTransportOrAssetUrl('https://app.test/reflected/parameter/body?q=x')).toBe(false)
    expect(isTransportOrAssetUrl(':::not a url:::')).toBe(false)
  })

  it('extractWorkflows skips transport/asset endpoints, keeps app routes', () => {
    const store = mockStore([
      ep('e1', 'https://app.test/favicon.ico'),
      ep('e2', 'https://app.test/socket.io/', 'POST'),
      ep('e3', 'https://app.test/api/orders/12345'),
    ])
    const names = extractWorkflows(store).map(w => w.name)
    expect(names.some(n => /favicon|socket\.io/i.test(n))).toBe(false)
    expect(names.length).toBeGreaterThan(0)
  })

  it('extractWorkflows names the route, never a query-string value', () => {
    const store = mockStore([
      ep('e1', 'https://app.test/remoteinclude/parameter/script?q=https://google.com/x'),
    ])
    const names = extractWorkflows(store).map(w => w.name)
    expect(names.some(n => /google\.com/i.test(n))).toBe(false)
  })

  it('extractEntities skips asset endpoints instead of minting bundle entities', () => {
    const store = mockStore([
      ep('e1', 'https://app.test/static/app.js'),
      ep('e2', 'https://app.test/api/orders/12345'),
    ])
    const names = extractEntities(store).map(e => e.name)
    expect(names.some(n => /app\.js/i.test(n))).toBe(false)
    expect(names.length).toBeGreaterThan(0)
  })

  it('withholds keyword-claimed state changes without corroborating structure', () => {
    const store = mockStore([
      ep('e1', 'https://app.test/dom/toxicdom/sessionStorage/array/eval'),
      ep('e2', 'https://app.test/dom/toxicdom/sessionStorage/array/innerHtml'),
    ])
    const workflows = extractWorkflows(store)
    for (const w of workflows) expect(w.stateChanges).toEqual([])
  })

  it('keeps keyword state changes when inputs corroborate them', () => {
    const withParams = {
      id: 'e1',
      type: NodeType.ENDPOINT,
      properties: {
        url: 'https://app.test/login',
        method: 'POST',
        params: [{ name: 'username' }, { name: 'password' }],
        tags: [],
        source: 'har-bridge',
      },
    } as any
    const store = mockStore([withParams])
    const workflows = extractWorkflows(store)
    expect(workflows.some(w => w.stateChanges.length > 0)).toBe(true)
  })

  it('keeps operator-recorded request order and provenance in the research map', () => {
    const endpoint = ep('e1', 'https://app.test/api/offer/redeem', 'POST')
    endpoint.properties.params = [{ name: 'offer', type: 'string', in: 'body' }]
    const recorded: WorkflowNode = {
      id: 'workflow:observed', type: NodeType.WORKFLOW, label: 'Observed offer flow',
      properties: {
        name: 'operator-demonstration', entryUrl: 'https://app.test/api/offer/redeem',
        steps: [
          { action: 'request', url: 'https://app.test/api/offer/redeem', endpointId: 'e1', method: 'GET', requestId: 'cap-1' },
          { action: 'request', url: 'https://app.test/api/offer/redeem', endpointId: 'e1', method: 'POST', requestId: 'cap-2' },
        ],
        relatedEndpoints: ['e1'], inputFields: ['offer'], stateChanges: ['POST'], observedRoles: [],
        confidence: 1, capturedRequestIds: ['cap-1', 'cap-2'], source: 'operator-demonstration',
        sequenceObserved: true,
      },
      createdAt: 1, updatedAt: 1,
    }
    const workflows = extractWorkflows(mockStore([endpoint], [recorded]))
    const observed = workflows.find(workflow => workflow.id === recorded.id)!

    expect(observed).toMatchObject({
      source: 'operator-demonstration', sequenceObserved: true,
      capturedRequestIds: ['cap-1', 'cap-2'],
      steps: [{ method: 'GET', requestId: 'cap-1' }, { method: 'POST', requestId: 'cap-2' }],
    })
    expect(generateHypotheses(mockStore([endpoint], [recorded]), workflows, [])
      .some(hypothesis => hypothesis.kind === 'workflow_bypass' && hypothesis.relatedWorkflowIds.includes(recorded.id))).toBe(true)
  })

  it('does not turn endpoint clusters into observed workflow-bypass hypotheses', () => {
    const get = ep('e1', 'https://app.test/api/checkout', 'GET')
    const post = ep('e2', 'https://app.test/api/checkout', 'POST')
    post.properties.params = [{ name: 'total', type: 'number', in: 'body' }]
    const store = mockStore([get, post])
    const workflows = extractWorkflows(store)

    expect(workflows.some(workflow => workflow.steps.length >= 2 && workflow.source === 'endpoint-inference')).toBe(true)
    expect(workflows.every(workflow => workflow.sequenceObserved === false)).toBe(true)
    expect(generateHypotheses(store, workflows, []).some(hypothesis => hypothesis.kind === 'workflow_bypass')).toBe(false)
  })

  it('uncorroborated keyword workflows yield no bypass hypothesis', () => {
    const store = mockStore([
      ep('e1', 'https://app.test/dom/toxicdom/sessionStorage/array/eval'),
      ep('e2', 'https://app.test/dom/toxicdom/sessionStorage/array/innerHtml'),
    ])
    const hyps = generateHypotheses(store, extractWorkflows(store), extractEntities(store))
    expect(hyps.some(h => h.kind === 'workflow_bypass')).toBe(false)
  })
})
