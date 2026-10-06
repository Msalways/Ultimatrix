import { describe, expect, it } from 'vitest'
import { planExperiments } from '../../src/research/experiment-planner'
import { NodeType, type EndpointNode } from '../../src/graph/schema'
import type { ResearchHypothesis } from '../../src/research/types'

describe('planExperiments action-limit plans', () => {
  it('keeps the exact observed rule and captured request in a bounded primitive plan', () => {
    const endpoint: EndpointNode = {
      id: 'coupon-redeem', type: NodeType.ENDPOINT,
      properties: { url: 'https://app.test/api/coupon/redeem', method: 'POST', params: [] },
    }
    const store = { getNode: (id: string) => id === endpoint.id ? endpoint : undefined } as any
    const hypothesis: ResearchHypothesis = {
      id: 'h-action-limit', title: 'Observed action limit of 1 may be unenforced', kind: 'action_limit',
      reason: 'captured rule and action', targetEndpoints: [endpoint.id], relatedWorkflowIds: [],
      relatedEntityIds: [], requiredSetup: [], risk: 'medium', confidence: 0.62, status: 'open',
      businessRule: {
        kind: 'action_limit', allowedCount: 1, actionRequestId: 'cap-action', actionMethod: 'POST',
        actionUrl: 'https://app.test/api/coupon/redeem', ruleCaptureId: 'cap-rule',
        ruleUrl: 'https://app.test/api/coupon/redeem', ruleText: 'may only be used once',
      },
    }

    const [experiment] = planExperiments(store, [hypothesis])

    expect(experiment).toMatchObject({
      title: 'Verify the observed 1-action limit',
      baselineRequest: { method: 'POST', url: 'https://app.test/api/coupon/redeem' },
      tools: ['listCapturedRequests', 'recordEvidence', 'runPrimitive', 'writeFinding'],
      status: 'planned',
    })
    expect(experiment.mutation).toContain('capturedRequestId=cap-action')
    expect(experiment.mutation).toContain('allowedCount=1')
    expect(experiment.mutation).toContain('iterations=2')
    expect(experiment.mutation).toContain(`context.experimentId=${experiment.id}`)
    expect(experiment.mutation).toContain('context.experimentPhase=initial')
    expect(experiment.mutation).toContain('pass its new baselineEvidenceId')
    expect(experiment.mutation).toContain('context.experimentPhase=retest')
    expect(experiment.setup.join(' ')).toContain('same actor')
  })
})

describe('planExperiments workflow plans', () => {
  it('includes the typed executor that owns captured workflow replay', () => {
    const endpoint: EndpointNode = {
      id: 'finalize', type: NodeType.ENDPOINT,
      properties: { url: 'https://app.test/api/checkout/finalize', method: 'POST', params: [] },
    }
    const store = { getNode: (id: string) => id === endpoint.id ? endpoint : undefined } as any
    const hypothesis: ResearchHypothesis = {
      id: 'h-workflow', title: 'Observed checkout finalization can be replayed', kind: 'workflow_bypass',
      reason: 'captured multi-step workflow', targetEndpoints: [endpoint.id], relatedWorkflowIds: ['wf-checkout'],
      relatedEntityIds: [], requiredSetup: [], risk: 'high', confidence: 0.8, status: 'open',
    }

    const [experiment] = planExperiments(store, [hypothesis])

    expect(experiment.tools).toContain('executePlannedExperiment')
    expect(experiment.baselineRequest).toEqual({ method: 'POST', url: 'https://app.test/api/checkout/finalize', headers: undefined })
  })
})
