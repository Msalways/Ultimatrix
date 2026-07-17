import { describe, it, expect } from 'vitest'
import { atoChain } from '../../src/primitives/atoChain'
import { runPrimitive } from '../../src/primitives/framework'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import type { AttackStep, StepExecutionResult, TechniqueContext } from '../../src/primitives/framework'

function fakeExecutor(vulnerable: boolean): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => {
    const kind = (step.metadata as any)?.kind as string
    if (vulnerable) {
      // Profile-swap accepted (IDOR -> takeover), reset accepted (not session-bound),
      // 2fa accepted (bypass). All 200/granted.
      return { step, ok: true, status: 200, body: '{"status":"ok","accountId":"VICTIM"}' }
    }
    // Safe: every sensitive action denied for the actor.
    if (kind === '2fa') {
      return { step, ok: true, status: 401, body: '{"error":"2fa required"}' }
    }
    return { step, ok: true, status: 403, body: 'forbidden' }
  }
}

const ctx: TechniqueContext = {
  endpoint: { url: 'https://api.example.com/account/100', method: 'GET' },
  objectId: '100',
  altObjectId: '200',
  sessionHeaders: { Authorization: 'Bearer ACTOR' },
  roles: ['user'],
}

describe('atoChain', () => {
  it('appliesTo requires a session or roles', () => {
    expect(atoChain.appliesTo(ctx)).toBe(true)
    expect(atoChain.appliesTo({ ...ctx, sessionHeaders: undefined, roles: [] } as TechniqueContext)).toBe(false)
    expect(atoChain.appliesTo({ ...ctx, endpoint: undefined, target: undefined } as TechniqueContext)).toBe(false)
  })

  it('confirms critical ATO when profile-swap and reset are accepted', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(atoChain, ctx, fakeExecutor(true), gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('critical')
    expect(res.finding?.category).toBe('account_takeover')
    expect(res.note).toContain('swapWin=true')
    expect(res.note).toContain('verified=true')
  })

  it('does not confirm when all sensitive actions are denied', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(atoChain, ctx, fakeExecutor(false), gate)
    expect(res.confirmed).toBe(false)
    expect(res.finding).toBeUndefined()
  })
})
