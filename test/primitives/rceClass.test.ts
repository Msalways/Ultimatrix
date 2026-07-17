import { describe, it, expect } from 'vitest'
import { rceClass } from '../../src/primitives/rceClass'
import { runPrimitive } from '../../src/primitives/framework'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import type { AttackStep, StepExecutionResult, TechniqueContext } from '../../src/primitives/framework'

/**
 * Fake executor: in `ssti` mode the SSTI step returns a body containing '49';
 * in `cmd` mode the CMD step returns 'uid=0(root)'; otherwise everything is benign.
 */
function fakeExecutor(
  mode: 'ssti' | 'cmd' | 'safe',
): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => {
    const kind = (step.metadata as any)?.kind as string
    if (mode === 'ssti' && kind === 'ssti') {
      return { step, ok: true, status: 200, body: 'rendered output: 49' }
    }
    if (mode === 'cmd' && kind === 'cmd') {
      return { step, ok: true, status: 200, body: 'uid=0(root) gid=0(root)' }
    }
    return { step, ok: true, status: 200, body: 'ok' }
  }
}

const ctx: TechniqueContext = {
  endpoint: { url: 'https://api.example.com/search', method: 'GET' },
  param: 'q',
  sessionHeaders: { Authorization: 'Bearer ACTOR' },
}

describe('rceClass', () => {
  it('appliesTo requires an endpoint/target', () => {
    expect(rceClass.appliesTo(ctx)).toBe(true)
    expect(rceClass.appliesTo({} as TechniqueContext)).toBe(false)
  })

  it('generates SSTI/CMD/PROTO/XXE steps tagged with metadata.kind', async () => {
    const steps = await rceClass.generate(ctx)
    const kinds = steps.map((s) => s.metadata?.kind)
    expect(kinds).toContain('ssti')
    expect(kinds).toContain('cmd')
    expect(kinds).toContain('proto')
    expect(kinds).toContain('xxe')
  })

  it('confirms high-severity RCE (SSTI) when response reflects 49', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(rceClass, ctx, fakeExecutor('ssti'), gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('high')
    expect(res.finding?.category).toBe('rce')
    expect(res.note).toContain('ssti')
  })

  it('confirms critical RCE (command injection) when response echoes uid=', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(rceClass, ctx, fakeExecutor('cmd'), gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('critical')
    expect(res.note).toContain('cmd')
  })

  it('does not confirm when all responses are benign', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(rceClass, ctx, fakeExecutor('safe'), gate)
    expect(res.confirmed).toBe(false)
    expect(res.finding).toBeUndefined()
  })
})
