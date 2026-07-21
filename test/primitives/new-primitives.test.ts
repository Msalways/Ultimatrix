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

  it('businessLogicAbuse — action-limit overrun when repeats succeed', async () => {
    const p = getPrimitive('businessLogicAbuse') ?? businessLogicAbuse
    const res = await runPrimitive(p, { target: 'https://app/otp', endpoint: { url: 'https://app/otp', method: 'POST' }, param: 'code', state: { blaKind: 'action_limit', value: '1', iterations: 5, allowedCount: 1 } }, executorFor(() => ({ status: 200, body: 'ok' })), gate)
    expect(res.confirmed).toBe(true)
  })
})
