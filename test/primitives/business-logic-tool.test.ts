import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  httpExecute: vi.fn(),
  experiment: { id: 'exp-action-limit', type: 'Experiment', properties: {} as Record<string, any>, updatedAt: 0 },
  hypothesis: { id: 'hyp-action-limit', type: 'Hypothesis', properties: {} as Record<string, any> },
  graphStore: {
    getNode: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@mastra/core/tools', () => ({ createTool: (config: any) => config }))
vi.mock('../../src/tools/http-tools', () => ({ httpRequest: { execute: mocks.httpExecute } }))
vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => mocks.graphStore }))

import { runPrimitiveTool } from '../../src/primitives'
import { getCapturedRequestStore } from '../../src/capture/captured-request-store'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { coreEvidenceLedger } from '../../src/core/evidence'

describe('businessLogicAbuse captured request wiring', () => {
  beforeEach(() => {
    mocks.httpExecute.mockReset()
    getCapturedRequestStore().clear()
    new EvidenceGate().clear()
    mocks.experiment.properties = {}
    mocks.hypothesis.properties = {}
    mocks.graphStore.getNode.mockImplementation((id: string) => id === mocks.experiment.id ? mocks.experiment : id === mocks.hypothesis.id ? mocks.hypothesis : undefined)
    mocks.graphStore.save.mockClear()
  })

  it('resolves the canonical captured request and verifies rule, baseline, and over-limit state change', async () => {
    const captured = getCapturedRequestStore().record({
      method: 'POST',
      url: 'https://app.test/offer',
      headers: { authorization: 'Bearer captured-secret', 'content-type': 'application/json' },
      body: '{"code":"WELCOME"}',
      source: 'browser',
      status: 200,
    })
    const gate = new EvidenceGate()
    gate.recordObserved({
      type: 'raw_response', label: 'visible offer terms',
      data: '<p>This offer may only be used once.</p>',
      observed: { method: 'GET', url: 'https://app.test/offer', status: 200 },
    })
    gate.recordObserved({
      type: 'raw_response', label: 'account baseline', data: '{"balance":0}',
      observed: { method: 'GET', url: 'https://app.test/account', status: 200 },
    })

    let balance = 0
    mocks.httpExecute.mockImplementation(async (request: Record<string, any>) => {
      balance += 1
      expect(request).toMatchObject({
        method: 'POST', url: 'https://app.test/offer', body: '{"code":"WELCOME"}',
        headers: { authorization: 'Bearer session-ref', 'content-type': 'application/json' },
      })
      return { ok: true, value: { status: 200, headers: {}, body: JSON.stringify({ balance }) } }
    })

    const result = await runPrimitiveTool.execute({
      primitiveId: 'businessLogicAbuse',
      context: {
        target: 'https://app.test/offer',
        endpointUrl: 'https://app.test/offer',
        endpointMethod: 'POST',
        capturedRequestId: captured.id,
        // A caller-supplied template must not override the canonical capture.
        requestTemplate: { method: 'POST', url: 'https://app.test/offer', headers: {}, body: '{"code":"invented"}' },
        sessionHeaders: { authorization: 'Bearer session-ref' },
        state: {
          blaKind: 'action_limit', allowedCount: 1, iterations: 2,
          ruleEvidenceUrl: 'https://app.test/offer', ruleText: 'This offer may only be used once.',
          baselineUrl: 'https://app.test/account', stateKey: 'balance', baselineValue: 0,
        },
      },
      commit: false,
    }) as any

    expect(mocks.httpExecute).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, result: { confirmed: true, candidate: false } })
    expect(result.result.finding.description).toContain('balance from 1 to 2')
  })

  it('does not send state-changing requests before rule and baseline evidence are present', async () => {
    const captured = getCapturedRequestStore().record({
      method: 'POST', url: 'https://app.test/offer', headers: { 'content-type': 'application/json' },
      body: '{"code":"WELCOME"}', source: 'browser', status: 200,
    })
    mocks.httpExecute.mockResolvedValue({ ok: true, value: { status: 200, headers: {}, body: '{"balance":1}' } })

    const result = await runPrimitiveTool.execute({
      primitiveId: 'businessLogicAbuse',
      context: {
        target: 'https://app.test/offer', endpointUrl: 'https://app.test/offer', endpointMethod: 'POST',
        capturedRequestId: captured.id,
        state: {
          blaKind: 'action_limit', allowedCount: 1, iterations: 2,
          ruleEvidenceUrl: 'https://app.test/offer', ruleText: 'This offer may only be used once.',
          baselineUrl: 'https://app.test/account', stateKey: 'balance', baselineValue: 0,
        },
      },
      commit: false,
    }) as any

    expect(result).toMatchObject({ ok: true, skipped: true })
    expect(mocks.httpExecute).not.toHaveBeenCalled()
  })

  it('attaches initial proof and independent retest to the planned action-limit experiment', async () => {
    const captures = getCapturedRequestStore()
    let evidenceTimestamp = Date.now()
    const action = captures.record({
      method: 'POST', url: 'https://app.test/offer',
      headers: { 'x-session-id': 'actor-a', 'content-type': 'application/json' },
      body: '{"code":"WELCOME"}', source: 'browser', status: 200,
    })
    const ruleCapture = captures.record({
      method: 'GET', url: 'https://app.test/terms', status: 200, source: 'browser',
      responseBody: 'This offer may only be used once.',
    })
    coreEvidenceLedger.record({ type: 'raw_response', label: 'offer rule', data: ruleCapture.responseBody!, timestamp: ++evidenceTimestamp, observed: {
      method: 'GET', url: ruleCapture.url, status: ruleCapture.status, responseBody: ruleCapture.responseBody, captureId: ruleCapture.id,
    } })
    mocks.hypothesis.properties = {
      kind: 'action_limit', businessRule: {
        kind: 'action_limit', allowedCount: 1, actionRequestId: action.id, actionMethod: 'POST',
        actionUrl: action.url, ruleCaptureId: ruleCapture.id, ruleUrl: ruleCapture.url,
        ruleText: 'This offer may only be used once.',
      },
    }
    mocks.experiment.properties = {
      status: 'planned', hypothesisId: mocks.hypothesis.id,
      baselineRequest: { method: 'POST', url: action.url },
    }

    let balance = 0
    const makeBaseline = (value: number) => {
      const body = JSON.stringify({ balance: value })
      const captured = captures.record({ method: 'GET', url: 'https://app.test/account', status: 200, source: 'tool', responseBody: body, headers: { 'x-session-id': 'actor-a' } })
      return coreEvidenceLedger.record({ type: 'raw_response', label: 'account baseline', data: body, observed: {
        method: 'GET', url: captured.url, status: 200, responseBody: body,
        requestHeaders: captured.headers, captureId: captured.id,
      }, timestamp: ++evidenceTimestamp })
    }
    mocks.httpExecute.mockImplementation(async (request: Record<string, any>) => {
      balance += 1
      const body = JSON.stringify({ balance })
      const executionId = `action-${balance}`
      const captured = captures.record({
        method: request.method, url: request.url, headers: request.headers, body: request.body,
        status: 200, responseBody: body, executionId,
      })
      const evidence = coreEvidenceLedger.record({ type: 'raw_response', label: `POST ${request.url}`, data: body, timestamp: ++evidenceTimestamp, observed: {
        method: request.method, url: request.url, status: 200, responseBody: body,
        requestHeaders: request.headers, requestBody: request.body, captureId: captured.id, executionId,
      } })
      return { ok: true, value: { status: 200, headers: {}, body, evidenceId: evidence.id, capturedRequestId: captured.id, executionId } }
    })

    const callPhase = async (experimentPhase: 'initial' | 'retest', baselineValue: number, existingBaseline?: ReturnType<typeof makeBaseline>) => {
      const baseline = existingBaseline ?? makeBaseline(baselineValue)
      return runPrimitiveTool.execute({
        primitiveId: 'businessLogicAbuse',
        context: {
          target: action.url, endpointUrl: action.url, endpointMethod: 'POST',
          capturedRequestId: action.id, experimentId: mocks.experiment.id, experimentPhase,
          sessionHeaders: { 'x-session-id': 'actor-a' },
          state: {
            blaKind: 'action_limit', allowedCount: 1, iterations: 2,
            ruleEvidenceUrl: ruleCapture.url, ruleText: 'This offer may only be used once.',
            baselineUrl: 'https://app.test/account', baselineEvidenceId: baseline.id,
            stateKey: 'balance', baselineValue,
          },
        },
        commit: false,
      }) as any
    }

    const staleRetestBaseline = makeBaseline(0)
    const initial = await callPhase('initial', 0)
    expect(initial).toMatchObject({ ok: true, experiment: { id: mocks.experiment.id, phase: 'initial', outcome: { status: 'proven' } } })
    expect(mocks.experiment.properties.status).toBe('interesting')
    expect(mocks.experiment.properties.outcome.proof.evidenceRefs).toHaveLength(3)

    const staleRetest = await callPhase('retest', 0, staleRetestBaseline)
    expect(staleRetest).toMatchObject({ ok: false, reason: 'Retest requires a fresh baseline captured after the initial proof.' })
    expect(mocks.httpExecute).toHaveBeenCalledTimes(2)

    const retest = await callPhase('retest', balance)
    expect(retest).toMatchObject({ ok: true, experiment: { id: mocks.experiment.id, phase: 'retest', outcome: { status: 'proven', proof: { phase: 'retest' } } } })
    expect(mocks.experiment.properties.retest.outcome.proof.evidenceRefs).toHaveLength(3)
    expect(mocks.experiment.properties.retest.outcome.proof.evidenceRefs).not.toEqual(mocks.experiment.properties.outcome.proof.evidenceRefs)
    expect(mocks.experiment.properties.status).toBe('interesting')
    expect(mocks.graphStore.save).toHaveBeenCalledTimes(2)
  })
})
