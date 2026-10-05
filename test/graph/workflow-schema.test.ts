import { describe, expect, it } from 'vitest'
import { WorkflowSchema } from '../../src/graph/schema'

describe('WorkflowSchema', () => {
  it('retains whether an ordered request sequence was directly observed', () => {
    const workflow = WorkflowSchema.parse({
      name: 'operator-demonstration',
      steps: [
        { action: 'request', method: 'POST', requestId: 'cap-1' },
        { action: 'request', method: 'POST', requestId: 'cap-2' },
      ],
      relatedEndpoints: ['ep:one', 'ep:two'],
      inputFields: [],
      stateChanges: ['POST'],
      observedRoles: [],
      confidence: 1,
      capturedRequestIds: ['cap-1', 'cap-2'],
      source: 'operator-demonstration',
      sequenceObserved: true,
    })

    expect(workflow.sequenceObserved).toBe(true)
  })
})
