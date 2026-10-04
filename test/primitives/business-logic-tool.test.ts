import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ httpExecute: vi.fn() }))

vi.mock('@mastra/core/tools', () => ({ createTool: (config: any) => config }))
vi.mock('../../src/tools/http-tools', () => ({ httpRequest: { execute: mocks.httpExecute } }))

import { runPrimitiveTool } from '../../src/primitives'
import { getCapturedRequestStore } from '../../src/capture/captured-request-store'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'

describe('businessLogicAbuse captured request wiring', () => {
  beforeEach(() => {
    mocks.httpExecute.mockReset()
    getCapturedRequestStore().clear()
    new EvidenceGate().clear()
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
})
