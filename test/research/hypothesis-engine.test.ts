import { describe, it, expect } from 'vitest'
import { generateHypotheses } from '../../src/research/hypothesis-engine'
import type { GraphStore } from '../../src/graph/store'
import { NodeType, type EndpointNode } from '../../src/graph/schema'
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

describe('generateHypotheses (relation-native, no keyword regex)', () => {
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
})
