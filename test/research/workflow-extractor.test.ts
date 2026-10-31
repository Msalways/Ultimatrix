import { describe, expect, it } from 'vitest'
import { NodeType } from '../../src/graph/schema'
import { extractWorkflows } from '../../src/research/workflow-extractor'

describe('workflow extraction provenance', () => {
  it('maps same-origin page interactions as inferred, unexecuted workflows', () => {
    const rendered = [
      { id: 'link:1', type: NodeType.RENDERED_ELEMENT, label: 'link', createdAt: 1, updatedAt: 1, properties: {
        url: 'https://app.test/home', selector: 'a[href="/transfer"]', tag: 'a', isFormField: false,
        attributes: { href: '/transfer?token=secret' }, text: 'Transfer funds',
      } },
      { id: 'form:1', type: NodeType.RENDERED_ELEMENT, label: 'form', createdAt: 1, updatedAt: 1, properties: {
        url: 'https://app.test/home', selector: 'form[action="/api/transfer"]', tag: 'form', isFormField: false,
        attributes: { action: '/api/transfer', method: 'POST' },
      } },
      { id: 'field:1', type: NodeType.RENDERED_ELEMENT, label: 'field', createdAt: 1, updatedAt: 1, properties: {
        url: 'https://app.test/home', selector: '#amount', tag: 'input', name: 'amount', isFormField: true,
        attributes: { name: 'amount', type: 'number' },
      } },
      { id: 'external:1', type: NodeType.RENDERED_ELEMENT, label: 'external', createdAt: 1, updatedAt: 1, properties: {
        url: 'https://app.test/home', selector: 'a[href="outside"]', tag: 'a', isFormField: false,
        attributes: { href: 'https://outside.test/escape' }, text: 'Outside',
      } },
      { id: 'button:1', type: NodeType.RENDERED_ELEMENT, label: 'button', createdAt: 1, updatedAt: 1, properties: {
        url: 'https://app.test/home', selector: 'button:has-text("Review transfer")', tag: 'button', isFormField: false,
        attributes: {}, text: 'Review transfer',
      } },
    ]
    const store = { queryNodes: (type?: NodeType) => type === NodeType.RENDERED_ELEMENT ? rendered : [] }

    const workflow = extractWorkflows(store as any).find(item => item.source === 'render-inference')

    expect(workflow).toMatchObject({
      name: 'Page interactions on /home',
      sequenceObserved: false,
      inputFields: ['amount'],
      stateChanges: [],
    })
    expect(workflow?.steps.some(step => step.url === 'https://app.test/transfer')).toBe(true)
    expect(workflow?.steps.some(step => step.method === 'POST' && step.url === 'https://app.test/api/transfer')).toBe(true)
    expect(workflow?.steps.some(step => step.url?.includes('outside.test'))).toBe(false)
    expect(workflow?.steps.some(step => step.action === 'button available: Review transfer')).toBe(true)
  })

  it('preserves browser-observed request order as a sequence', () => {
    const observed = {
      id: 'workflow:browser',
      type: NodeType.WORKFLOW,
      label: 'Browser observed workflow',
      createdAt: 1,
      updatedAt: 2,
      properties: {
        name: 'browser-observation',
        entryUrl: 'https://app.test/offers',
        steps: [
          { action: 'GET offers', method: 'GET', url: 'https://app.test/offers', requestId: 'cap-1' },
          { action: 'POST redeem', method: 'POST', url: 'https://app.test/redeem', requestId: 'cap-2' },
        ],
        relatedEndpoints: ['ep:offers', 'ep:redeem'],
        inputFields: ['input[name=offer]'],
        stateChanges: ['POST'],
        observedRoles: [],
        confidence: 0.8,
        capturedRequestIds: ['cap-1', 'cap-2'],
        source: 'browser-observation',
        capturedAt: 1,
        sequenceObserved: true,
      },
    }
    const store = {
      queryNodes: (type?: NodeType) => type === NodeType.WORKFLOW ? [observed] : [],
    }

    const workflows = extractWorkflows(store as any)

    expect(workflows).toHaveLength(1)
    expect(workflows[0]).toMatchObject({
      id: 'workflow:browser',
      source: 'browser-observation',
      sequenceObserved: true,
      capturedRequestIds: ['cap-1', 'cap-2'],
      steps: [
        { method: 'GET', requestId: 'cap-1' },
        { method: 'POST', requestId: 'cap-2' },
      ],
    })
  })

  it('does not elevate browser request order without sequence evidence', () => {
    const observed = {
      id: 'workflow:partial',
      type: NodeType.WORKFLOW,
      label: 'Partial browser trace',
      createdAt: 1,
      updatedAt: 2,
      properties: {
        name: 'browser-observation',
        steps: [
          { action: 'GET offers', method: 'GET', url: 'https://app.test/offers', requestId: 'cap-1' },
          { action: 'POST redeem', method: 'POST', url: 'https://app.test/redeem', requestId: 'cap-2' },
        ],
        relatedEndpoints: [], inputFields: [], stateChanges: [], observedRoles: [], confidence: 0.5,
        capturedRequestIds: ['cap-1', 'cap-2'], source: 'browser-observation', sequenceObserved: false,
      },
    }
    const store = { queryNodes: (type?: NodeType) => type === NodeType.WORKFLOW ? [observed] : [] }

    expect(extractWorkflows(store as any)[0]?.sequenceObserved).toBe(false)
  })
})
