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

  it('keeps an accepted replay as a candidate even with a custom non-English success body', async () => {
    const p = getPrimitive('workflowBypass')!
    const res = await runPrimitive(
      p,
      {
        target: 'https://t.example/checkout',
        endpoint: { url: 'https://t.example/checkout', method: 'POST' },
        workflowSteps: ['POST /orders/draft', 'POST /orders/finish'],
        requestTemplate: { method: 'POST', url: 'https://t.example/checkout', headers: { 'Content-Type': 'application/json' }, body: '{"order":"observed"}' },
      },
      executorFor(() => ({ status: 200, body: 'Commande validée avec succès' })),
      gate,
    )
    // Replay accepted (status-driven), but prior workflow state is not ruled out.
    expect(res.confirmed).toBe(false)
    expect(res.candidate).toBe(true)
    expect(res.confidence).toBeGreaterThan(0.1)
    expect(res.note ?? '').toContain('fresh actor/session verification required')
  })

  it('does NOT flag a bypass when the server denies with a custom non-English 403', async () => {
    const p = getPrimitive('workflowBypass')!
    const res = await runPrimitive(
      p,
      {
        target: 'https://t.example/checkout',
        endpoint: { url: 'https://t.example/checkout', method: 'POST' },
        workflowSteps: ['POST /orders/draft', 'POST /orders/finish'],
        requestTemplate: { method: 'POST', url: 'https://t.example/checkout', headers: { 'Content-Type': 'application/json' }, body: '{"order":"observed"}' },
      },
      executorFor(() => ({ status: 403, body: 'Zugriff verweigert. Bitte einloggen.' })),
      gate,
    )
    expect(res.confidence).toBe(0.1)
    expect(res.note ?? '').toContain('denied=true')
  })

  it('replays the captured terminal request exactly and refuses a synthetic fallback', async () => {
    const p = getPrimitive('workflowBypass')!
    const template = {
      method: 'PATCH',
      url: 'https://t.example/api/x?version=3',
      headers: { Authorization: 'Bearer actor', 'Content-Type': 'application/json' },
      body: '{"status":"ready"}',
    }
    const ctx = {
      endpoint: { url: 'https://t.example/api/x', method: 'PATCH' },
      workflowSteps: ['POST /api/start', 'PATCH /api/x'],
      requestTemplate: template,
    }
    const [step] = await p.generate(ctx)
    expect(step?.request).toEqual(template)
    expect(await p.generate({ endpoint: ctx.endpoint, workflowSteps: ctx.workflowSteps })).toEqual([])
  })
})
