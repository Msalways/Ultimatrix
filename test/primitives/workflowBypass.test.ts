import { describe, it, expect, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { getPrimitive, runPrimitive, claimFor, type AttackStep, type StepExecutionResult } from '../../src/primitives/framework'
import { workflowBypass } from '../../src/primitives/workflowBypass'
import '../../src/primitives'

const gate = new EvidenceGate()
beforeEach(() => gate.clear())

function executorFor(map: (step: AttackStep) => Partial<StepExecutionResult>) {
  return async (step: AttackStep): Promise<StepExecutionResult> => ({
    step,
    ok: true,
    status: 200,
    headers: {},
    body: '',
    ...map(step),
  })
}

describe('workflowBypass primitive — behavioral (anti-rigidity)', () => {
  it('is registered', () => {
    expect(getPrimitive('workflowBypass')).toBe(workflowBypass)
  })

  it('flags a bypass on a 2xx even with a custom non-English success body (status-authoritative)', async () => {
    const p = getPrimitive('workflowBypass')!
    const res = await runPrimitive(
      p,
      { target: 'https://t.example/checkout', endpoint: { url: 'https://t.example/checkout', method: 'POST' } },
      executorFor(() => ({ status: 200, body: 'Commande validée avec succès' })),
      gate,
    )
    // bypassed (status-driven) → confidence reflects behavioral verdict.
    expect(res.confidence).toBeGreaterThan(0.1)
    expect(res.note ?? '').toContain('granted=true')
  })

  it('does NOT flag a bypass when the server denies with a custom non-English 403', async () => {
    const p = getPrimitive('workflowBypass')!
    const res = await runPrimitive(
      p,
      { target: 'https://t.example/checkout', endpoint: { url: 'https://t.example/checkout', method: 'POST' } },
      executorFor(() => ({ status: 403, body: 'Zugriff verweigert. Bitte einloggen.' })),
      gate,
    )
    expect(res.confidence).toBe(0.1)
    expect(res.note ?? '').toContain('denied=true')
  })
})
