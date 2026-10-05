import { describe, expect, it } from 'vitest'
import { NodeType } from '../../src/graph/schema'
import { extractWorkflows } from '../../src/research/workflow-extractor'

describe('workflow extraction provenance', () => {
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
