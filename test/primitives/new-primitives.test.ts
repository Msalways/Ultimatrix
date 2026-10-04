import { describe, it, expect, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { getPrimitive, runPrimitive, type AttackStep, type StepExecutionResult } from '../../src/primitives/framework'
import { nosqlInjection } from '../../src/primitives/nosqlInjection'
import { sstiBlind } from '../../src/primitives/sstiBlind'
import { internalStateDisclosure } from '../../src/primitives/internalStateDisclosure'
import { businessLogicAbuse } from '../../src/primitives/businessLogicAbuse'

const gate = new EvidenceGate()
beforeEach(() => gate.clear())

type ExecMap = (step: AttackStep) => Partial<StepExecutionResult>
function executorFor(map: ExecMap): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => ({ step, ok: true, status: 200, headers: {}, body: '', ...map(step) })
}

describe('new Wave2/3 primitives', () => {
  it('nosqlInjection — assistantAccess on operator auth bypass', async () => {
    const p = getPrimitive('nosqlInjection') ?? nosqlInjection
    const res = await runPrimitive(p, { target: 'https://app/api/login', endpoint: { url: 'https://app/api/login', method: 'POST' }, param: 'password' }, executorFor((s) => {
      if (s.metadata?.kind === 'nosql-bypass') return { status: 200, body: '{"token":"abc"}' }
      return { status: 200, body: 'denied' }
    }), gate)
    expect(res.confirmed).toBe(true)
    expect(res.finding?.category).toBe('nosql_injection')
  })

  it('nosqlInjection — no bypass → unconfirmed', async () => {
    const p = getPrimitive('nosqlInjection') ?? nosqlInjection
    const res = await runPrimitive(p, { target: 'https://app/api/login', endpoint: { url: 'https://app/api/login', method: 'POST' }, param: 'password' }, executorFor(() => ({ status: 401, body: 'invalid' })), gate)
    expect(res.confirmed).toBe(false)
  })

  it('sstiBlind — confirms on time-based delay', async () => {
    const p = getPrimitive('sstiBlind') ?? sstiBlind
    const res = await runPrimitive(p, { target: 'https://app/q', endpoint: { url: 'https://app/q', method: 'GET' }, param: 'name' }, executorFor((s) => (s.metadata?.kind === 'ssti-time' ? { status: 200, body: 'ok', durationMs: 5200 } : { status: 200, body: 'ok' })), gate)
    expect(res.confirmed).toBe(true)
  })

  it('internalStateDisclosure — leaks on invalid id', async () => {
    const p = getPrimitive('internalStateDisclosure') ?? internalStateDisclosure
    const res = await runPrimitive(p, { target: 'https://app/users', endpoint: { url: 'https://app/users', method: 'GET' }, objectId: '1', state: { invalidId: 'zzz' } }, executorFor((s) => {
      if (s.metadata?.kind === 'invalid') return { status: 500, body: 'java.lang.NullPointerException at com.app.UserRepo' }
      return { status: 200, body: '{"id":1}' }
    }), gate)
    expect(res.confirmed).toBe(true)
  })

  it('businessLogicAbuse does not invent a request or confirm repeated 2xx responses without a rule', async () => {
    const p = getPrimitive('businessLogicAbuse') ?? businessLogicAbuse
    let requests = 0
    const res = await runPrimitive(p, {
      target: 'https://app/otp', endpoint: { url: 'https://app/otp', method: 'POST' },
      param: 'code', state: { blaKind: 'action_limit', value: '1', iterations: 5, allowedCount: 1 },
    }, executorFor(() => { requests++; return { status: 200, body: 'ok' } }), gate)
    expect(requests).toBe(0)
    expect(res.confirmed).toBe(false)
    expect(res.candidate).toBe(false)
  })

  it('businessLogicAbuse confirms only a captured over-limit state change against observed rule and baseline evidence', async () => {
    const p = getPrimitive('businessLogicAbuse') ?? businessLogicAbuse
    gate.recordObserved({
      type: 'raw_response', label: 'offer terms', data: '<p>This offer may only be used once.</p>',
      observed: { url: 'https://app/offer', method: 'GET', status: 200 },
    })
    gate.recordObserved({
      type: 'raw_response', label: 'account baseline', data: '{"balance":0}',
      observed: { url: 'https://app/account', method: 'GET', status: 200 },
    })
    let balance = 0
    const res = await runPrimitive(p, {
      target: 'https://app/offer',
      endpoint: { url: 'https://app/offer', method: 'POST' },
      capturedRequestId: 'cap-41',
      requestTemplate: {
        method: 'POST', url: 'https://app/offer',
        headers: { authorization: 'Bearer captured', 'content-type': 'application/json' },
        body: '{"code":"WELCOME"}',
      },
      sessionHeaders: { authorization: 'Bearer session-ref' },
      state: {
        blaKind: 'action_limit', allowedCount: 1, iterations: 2,
        ruleEvidenceUrl: 'https://app/offer', ruleText: 'This offer may only be used once.',
        baselineUrl: 'https://app/account', stateKey: 'balance', baselineValue: 0,
      },
    }, executorFor((step) => {
      balance++
      expect(step.request).toMatchObject({
        method: 'POST', url: 'https://app/offer', body: '{"code":"WELCOME"}',
        headers: { authorization: 'Bearer session-ref', 'content-type': 'application/json' },
      })
      return { status: 200, body: JSON.stringify({ balance }) }
    }), gate)
    expect(res.confirmed).toBe(true)
    expect(res.candidate).toBe(false)
    expect(res.finding?.description).toContain('balance from 1 to 2')
    expect(res.evidence).toHaveLength(2)
  })

  it('businessLogicAbuse keeps accepted repeats as a candidate when no state transition is visible', async () => {
    const p = getPrimitive('businessLogicAbuse') ?? businessLogicAbuse
    const res = await runPrimitive(p, {
      target: 'https://app/offer', endpoint: { url: 'https://app/offer', method: 'POST' },
      capturedRequestId: 'cap-42',
      requestTemplate: { method: 'POST', url: 'https://app/offer', headers: {}, body: '{"code":"WELCOME"}' },
      state: {
        blaKind: 'quota', allowedCount: 1, iterations: 2,
        ruleEvidenceUrl: 'https://app/offer', ruleText: 'This offer may only be used once.',
        baselineUrl: 'https://app/account', stateKey: 'balance', baselineValue: 0,
      },
    }, executorFor(() => ({ status: 200, body: '{"message":"accepted"}' })), gate)
    expect(res.confirmed).toBe(false)
    expect(res.candidate).toBe(true)
  })
})
