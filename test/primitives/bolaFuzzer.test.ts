import { describe, it, expect } from 'vitest'
import { bolaFuzzer } from '../../src/primitives/bolaFuzzer'
import { runPrimitive } from '../../src/primitives/framework'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import type { AttackStep, StepExecutionResult, TechniqueContext } from '../../src/primitives/framework'

function fakeExecutor(vulnerable: boolean): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => {
    const kind = (step.metadata as any)?.kind as string
    if (vulnerable) {
      switch (kind) {
        case 'own':
          return { step, ok: true, status: 200, body: 'own data' }
        case 'read':
          return { step, ok: true, status: 200, body: 'victim data' }
        case 'write':
          return { step, ok: true, status: 200, body: 'updated' }
        case 'method':
          return { step, ok: true, status: 403, body: 'denied' }
        case 'mass':
          return { step, ok: true, status: 200, body: '{"role":"admin"}' }
      }
    }
    // Safe: everything denied for the actor on the victim's object.
    return { step, ok: true, status: 403, body: 'forbidden' }
  }
}

const ctx: TechniqueContext = {
  endpoint: { url: 'https://api.example.com/objects/100', method: 'GET' },
  objectId: '100',
  altObjectId: '200',
  sessionHeaders: { Authorization: 'Bearer ACTOR' },
  altSessionHeaders: { Authorization: 'Bearer VICTIM' },
}

describe('bolaFuzzer', () => {
  it('appliesTo requires alt object id + a session', () => {
    expect(bolaFuzzer.appliesTo(ctx)).toBe(true)
    expect(bolaFuzzer.appliesTo({ ...ctx, altObjectId: undefined } as TechniqueContext)).toBe(false)
    expect(bolaFuzzer.appliesTo({ ...ctx, sessionHeaders: undefined, altSessionHeaders: undefined } as TechniqueContext)).toBe(false)
  })

  it('confirms critical action-level BOLA when the actor can write the victim object', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(bolaFuzzer, ctx, fakeExecutor(true), gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('critical')
    expect(res.finding?.category).toBe('bola')
    expect(res.note).toContain('actionWrite=true')
  })

  it('does not confirm when access is properly denied', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(bolaFuzzer, ctx, fakeExecutor(false), gate)
    expect(res.confirmed).toBe(false)
    expect(res.finding).toBeUndefined()
  })

  it('flags horizontal read and mass-assignment independently', async () => {
    const gate = new EvidenceGate()
    // own/read allowed (divergent) + mass accepted, but writes denied.
    const exec: (s: AttackStep) => Promise<StepExecutionResult> = async (s) => {
      const kind = (s.metadata as any)?.kind as string
      if (kind === 'own') return { step: s, ok: true, status: 200, body: 'own data' }
      if (kind === 'read') return { step: s, ok: true, status: 200, body: 'victim data' }
      if (kind === 'mass') return { step: s, ok: true, status: 200, body: '{"role":"admin"}' }
      return { step: s, ok: true, status: 403, body: 'forbidden' }
    }
    const res = await runPrimitive(bolaFuzzer, ctx, exec, gate)
    expect(res.confirmed).toBe(true)
    // No action-level write => high, not critical.
    expect(res.severity).toBe('high')
    expect(res.note).toContain('horizontal=true')
    expect(res.note).toContain('massAssign=true')
  })
})
