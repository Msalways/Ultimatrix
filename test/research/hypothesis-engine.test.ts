import { describe, it, expect } from 'vitest'
import { generateHypotheses } from '../../src/research/hypothesis-engine'
import type { GraphStore } from '../../src/graph/store'
import { NodeType, type EndpointNode, validateNodeProperties } from '../../src/graph/schema'
import type { ResearchEntity, ResearchWorkflow } from '../../src/research/types'

function makeStore(endpoints: EndpointNode[]): GraphStore {
  const map = new Map(endpoints.map(e => [e.id, e]))
  return {
    queryNodes: (type: any, _filters?: any) =>
      type === NodeType.ENDPOINT ? [...map.values()] : [],
  } as unknown as GraphStore
}

const ep = (id: string, url: string, method = 'GET', params: any[] = []): EndpointNode => ({
  id,
  type: NodeType.ENDPOINT,
  properties: { url, method, params, tags: ['har-capture'], source: 'har-bridge' },
})

describe('generateHypotheses (evidence-linked and conservative)', () => {
  it('flags IDOR from a structured numeric id in the URL path', () => {
    const store = makeStore([ep('e1', 'https://app.test/api/orders/12345')])
    const entity: ResearchEntity = {
      id: 'entity:orders', name: 'Orders', ids: ['12345'], endpoints: ['e1'],
      ownerFields: [], roleFields: [], sensitiveFields: [], lifecycleStates: [], confidence: 0.5,
    }
    const hs = generateHypotheses(store, [], [entity])
    const idor = hs.find(h => h.kind === 'idor')
    expect(idor).toBeTruthy()
    expect(idor!.targetEndpoints).toContain('e1')
  })

  it('flags IDOR when a param references a structured id known to the entity', () => {
    // Replaces the old /uuid|slug/ keyword scan: identifier-ness comes from the
    // entity's typed id set, never a keyword match on the param name.
    const store = makeStore([ep('e2', 'https://app.test/api/items', 'GET', [{ name: 'itemId' }])])
    const entity: ResearchEntity = {
      id: 'entity:items', name: 'Items', ids: ['itemId'], endpoints: ['e2'],
      ownerFields: [], roleFields: [], sensitiveFields: [], lifecycleStates: [], confidence: 0.5,
    }
    const hs = generateHypotheses(store, [], [entity])
    expect(hs.find(h => h.kind === 'idor')).toBeTruthy()
  })

  it('does NOT flag a billing URL as info-disclosure when no sensitive fields present', () => {
    // Old code used /billing|invoice/ keyword scan; relation-native uses sensitiveFields only.
    const store = makeStore([ep('e3', 'https://app.test/api/billing/invoice')])
    const entity: ResearchEntity = {
      id: 'entity:billing', name: 'Billing', ids: [], endpoints: ['e3'],
      ownerFields: [], roleFields: [], sensitiveFields: [], lifecycleStates: [], confidence: 0.5,
    }
    const hs = generateHypotheses(store, [], [entity])
    expect(hs.find(h => h.kind === 'information_disclosure')).toBeFalsy()
  })

  it('flags info-disclosure from structured sensitiveFields', () => {
    const store = makeStore([ep('e4', 'https://app.test/api/x')])
    const entity: ResearchEntity = {
      id: 'entity:x', name: 'X', ids: [], endpoints: ['e4'],
      ownerFields: [], roleFields: [], sensitiveFields: ['ssn', 'email'], lifecycleStates: [], confidence: 0.5,
    }
    const hs = generateHypotheses(store, [], [entity])
    expect(hs.find(h => h.kind === 'information_disclosure')).toBeTruthy()
  })

  it('does not promote a bundle-only route into a hypothesis', () => {
    const jsOnly = ep('js1', 'https://app.test/api/orders/12345')
    jsOnly.properties.tags = ['js-mined']
    jsOnly.properties.source = 'post-crawl-discovery'
    const store = makeStore([jsOnly])
    const entity: ResearchEntity = {
      id: 'entity:orders', name: 'Orders', ids: ['12345'], endpoints: ['js1'],
      ownerFields: [], roleFields: [], sensitiveFields: [], lifecycleStates: [], confidence: 0.5,
    }
    expect(generateHypotheses(store, [], [entity])).toHaveLength(0)
  })

  it('uses JS route context after runtime correlation', () => {
    const correlated = ep('js2', 'https://app.test/api/orders/12345')
    correlated.properties.tags = ['js-mined', 'js-correlated']
    correlated.properties.source = 'har-bridge, post-crawl-discovery'
    const store = makeStore([correlated])
    const entity: ResearchEntity = {
      id: 'entity:orders', name: 'Orders', ids: ['12345'], endpoints: ['js2'],
      ownerFields: [], roleFields: [], sensitiveFields: [], lifecycleStates: [], confidence: 0.5,
    }
    expect(generateHypotheses(store, [], [entity]).find(h => h.kind === 'idor')).toBeTruthy()
  })

  it('derives access-control hypotheses from captured endpoint structure', () => {
    const endpoint = ep('e5', 'https://app.test/api/orders/41', 'GET')
    endpoint.properties.headers = { Authorization: 'Bearer redacted' }
    const hs = generateHypotheses(makeStore([endpoint]), [], [])
    expect(hs.find(h => h.kind === 'broken_access_control')?.targetEndpoints).toEqual(['e5'])
  })

  it('does not prioritize metadata endpoints as application hypotheses', () => {
    const endpoint = ep('e6', 'https://app.test/rest/admin/application-version', 'GET')
    endpoint.properties.headers = { Cookie: 'session=redacted' }
    expect(generateHypotheses(makeStore([endpoint]), [], [])).toHaveLength(0)
  })

  it('does not prioritize transport polling as application behavior', () => {
    const endpoint = ep('e7', 'https://app.test/socket.io/', 'POST', [{ name: 'sid' }])
    endpoint.properties.headers = { Cookie: 'session=redacted' }
    expect(generateHypotheses(makeStore([endpoint]), [], [])).toHaveLength(0)
  })

  it('rates workflow risk high from observedRoles / requiredAuth, not name keywords', () => {
    const store = makeStore([])
    const wfRole: ResearchWorkflow = {
      id: 'wf1', name: 'checkout flow', steps: [{ action: 'click' }, { action: 'submit' }],
      relatedEndpoints: [], inputFields: [], stateChanges: ['order placed'], observedRoles: ['admin'], confidence: 0.5,
    }
    const wfAuth: ResearchWorkflow = {
      id: 'wf2', name: 'login step', steps: [{ action: 'fill' }, { action: 'submit' }],
      relatedEndpoints: [], inputFields: [], stateChanges: [], requiredAuth: true, observedRoles: [], confidence: 0.5,
    }
    const wfLow: ResearchWorkflow = {
      id: 'wf3', name: 'browse products', steps: [{ action: 'click' }, { action: 'view' }],
      relatedEndpoints: [], inputFields: [], stateChanges: [], observedRoles: [], confidence: 0.5,
    }
    const hs = generateHypotheses(store, [wfRole, wfAuth, wfLow], [])
    const r = hs.find(h => h.kind === 'workflow_bypass' && h.relatedWorkflowIds.includes('wf1'))
    const a = hs.find(h => h.kind === 'workflow_bypass' && h.relatedWorkflowIds.includes('wf2'))
    const l = hs.find(h => h.kind === 'workflow_bypass' && h.relatedWorkflowIds.includes('wf3'))
    expect(r!.risk).toBe('high')
    expect(a!.risk).toBe('high')
    expect(l!.risk).toBe('medium')
  })

  it('learns an explicit bounded action limit and links it to a captured successful action', () => {
    const store = makeStore([ep('redeem', 'https://app.test/api/coupon/redeem', 'POST')])
    const captures = [
      {
        id: 'cap-rule', method: 'GET', url: 'https://app.test/api/coupon/redeem', headers: {},
        status: 200, responseBody: '<p>This offer may only be used once.</p>', source: 'browser' as const, capturedAt: 1,
      },
      {
        id: 'cap-action', method: 'POST', url: 'https://app.test/api/coupon/redeem', headers: {},
        body: '{"code":"WELCOME"}', status: 200, responseBody: '{"balance":10}', source: 'browser' as const, capturedAt: 2,
      },
    ]

    const hypothesis = generateHypotheses(store, [], [], captures).find(item => item.kind === 'action_limit')

    expect(hypothesis).toMatchObject({
      targetEndpoints: ['redeem'],
      businessRule: {
        kind: 'action_limit', allowedCount: 1,
        actionRequestId: 'cap-action', actionMethod: 'POST',
        ruleCaptureId: 'cap-rule', ruleText: 'may only be used once',
      },
    })
    const validation = validateNodeProperties(NodeType.HYPOTHESIS, {
      title: hypothesis!.title,
      kind: hypothesis!.kind,
      reason: hypothesis!.reason,
      targetEndpoints: hypothesis!.targetEndpoints,
      relatedWorkflowIds: hypothesis!.relatedWorkflowIds,
      relatedEntityIds: hypothesis!.relatedEntityIds,
      requiredSetup: hypothesis!.requiredSetup,
      risk: hypothesis!.risk,
      confidence: hypothesis!.confidence,
      status: hypothesis!.status,
      businessRule: hypothesis!.businessRule,
    })
    expect(validation.valid).toBe(true)
  })

  it('does not connect a limit statement to an unrelated route without an observed sequence', () => {
    const store = makeStore([ep('redeem', 'https://app.test/api/coupon/redeem', 'POST')])
    const captures = [
      {
        id: 'cap-rule', method: 'GET', url: 'https://app.test/terms', headers: {},
        status: 200, responseBody: '<p>Only one redemption per account.</p>', source: 'browser' as const, capturedAt: 1,
      },
      {
        id: 'cap-action', method: 'POST', url: 'https://app.test/api/coupon/redeem', headers: {},
        status: 200, responseBody: '{"balance":10}', source: 'browser' as const, capturedAt: 2,
      },
    ]

    expect(generateHypotheses(store, [], [], captures).some(item => item.kind === 'action_limit')).toBe(false)
  })

  it('links rules from another route only when both captures belong to an observed workflow sequence', () => {
    const store = makeStore([ep('redeem', 'https://app.test/api/coupon/redeem', 'POST')])
    const captures = [
      {
        id: 'cap-rule', method: 'GET', url: 'https://app.test/offers', headers: {},
        status: 200, responseBody: '<p>Maximum of 3 claims per account.</p>', source: 'browser' as const, capturedAt: 1,
      },
      {
        id: 'cap-action', method: 'POST', url: 'https://app.test/api/coupon/redeem', headers: {},
        status: 200, responseBody: '{"balance":10}', source: 'browser' as const, capturedAt: 2,
      },
    ]
    const workflow: ResearchWorkflow = {
      id: 'wf-offer', name: 'offer redemption', steps: [
        { action: 'GET offers', requestId: 'cap-rule' }, { action: 'POST redeem', requestId: 'cap-action' },
      ], capturedRequestIds: ['cap-rule', 'cap-action'], sequenceObserved: true,
      source: 'operator-demonstration', relatedEndpoints: ['redeem'], inputFields: ['code'],
      stateChanges: ['balance'], observedRoles: ['authenticated'], confidence: 1,
    }

    const hypothesis = generateHypotheses(store, [workflow], [], captures).find(item => item.kind === 'action_limit')

    expect(hypothesis?.businessRule).toMatchObject({ allowedCount: 3, ruleCaptureId: 'cap-rule', actionRequestId: 'cap-action' })
    expect(hypothesis?.relatedWorkflowIds).toEqual(['wf-offer'])
  })

  it('uses browser-observed ordered workflows for workflow and action-limit hypotheses', () => {
    const store = makeStore([ep('redeem', 'https://app.test/api/coupon/redeem', 'POST')])
    const captures = [
      {
        id: 'cap-rule', method: 'GET', url: 'https://app.test/offers', headers: {},
        status: 200, responseBody: '<p>Maximum of 3 claims per account.</p>', source: 'browser' as const, capturedAt: 1,
      },
      {
        id: 'cap-action', method: 'POST', url: 'https://app.test/api/coupon/redeem', headers: {},
        status: 200, responseBody: '{"balance":10}', source: 'browser' as const, capturedAt: 2,
      },
    ]
    const workflow: ResearchWorkflow = {
      id: 'wf-browser', name: 'browser-observed', steps: [
        { action: 'GET offers', requestId: 'cap-rule' }, { action: 'POST redeem', requestId: 'cap-action' },
      ], capturedRequestIds: ['cap-rule', 'cap-action'], sequenceObserved: true,
      source: 'browser-observation', relatedEndpoints: ['redeem'], inputFields: ['code'],
      stateChanges: ['balance'], observedRoles: [], confidence: 0.8,
    }

    const hypotheses = generateHypotheses(store, [workflow], [], captures)

    expect(hypotheses.find(item => item.kind === 'workflow_bypass')?.relatedWorkflowIds).toEqual(['wf-browser'])
    expect(hypotheses.find(item => item.kind === 'action_limit')?.relatedWorkflowIds).toEqual(['wf-browser'])
  })

  it('learns an explicit numeric cap without guessing above its bounded probe range', () => {
    const store = makeStore([ep('redeem', 'https://app.test/api/rewards/claim', 'POST')])
    const captures = [
      {
        id: 'cap-rule', method: 'GET', url: 'https://app.test/api/rewards/claim', headers: {},
        status: 200, responseBody: 'Each account may claim at most 4 rewards.', source: 'browser' as const, capturedAt: 1,
      },
      {
        id: 'cap-action', method: 'POST', url: 'https://app.test/api/rewards/claim', headers: {},
        status: 200, responseBody: '{"credits":4}', source: 'browser' as const, capturedAt: 2,
      },
    ]
    expect(generateHypotheses(store, [], [], captures).find(item => item.kind === 'action_limit')?.businessRule?.allowedCount).toBe(4)
    captures[0].responseBody = 'Each account may claim at most 10 rewards.'
    expect(generateHypotheses(store, [], [], captures).some(item => item.kind === 'action_limit')).toBe(false)
  })
})
