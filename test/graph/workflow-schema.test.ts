import { describe, expect, it } from 'vitest'
import { ExperimentSchema, WorkflowSchema } from '../../src/graph/schema'

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

describe('ExperimentSchema', () => {
  it('retains canonical request/response evidence refs from execution', () => {
    const experiment = ExperimentSchema.parse({
      hypothesisId: '00000000-0000-4000-8000-000000000001',
      title: 'Replay the observed terminal action',
      setup: [],
      mutation: 'Replay the captured request unchanged',
      expectedSecureBehavior: 'The one-time action is rejected',
      insecureSignal: 'The action changes state again',
      requiredActors: [],
      tools: ['executePlannedExperiment'],
      status: 'rejected',
      executionEvidenceRefs: ['ev_1_1', 'ev_1_2'],
    })

    expect(experiment.executionEvidenceRefs).toEqual(['ev_1_1', 'ev_1_2'])
  })
})
