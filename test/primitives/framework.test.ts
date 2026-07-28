import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import * as frameworkMod from '../../src/primitives/framework'
import { getPrimitive, runPrimitive, claimFor, loadPayloads, type AttackStep, type StepExecutionResult, type TechniquePrimitive } from '../../src/primitives/framework'
import { classicInjection } from '../../src/primitives/classicInjection'
import { headerInjection } from '../../src/primitives/headerInjection'

// EvidenceGate uses a shared singleton ledger; reset it before each test so the
// "unbacked claim" assertion sees a truly empty ledger.
const gate = new EvidenceGate()
beforeEach(() => gate.clear())

type ExecMap = (step: AttackStep) => Partial<StepExecutionResult>
function executorFor(map: ExecMap): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => ({
    step,
    ok: true,
    status: 200,
    headers: {},
    body: '',
    ...map(step),
  })
}

describe('primitives: confirmation now backed by structured ledger (fix)', () => {
  it('runPrimitive records observed facts so a claim verifies (the core fix)', async () => {
    // Inline primitive whose oracle ONLY checks the structured ledger — isolating
    // the framework.recordObserved + verifyClaim(claimFor) wiring from oracle logic.
    const probe: TechniquePrimitive = {
      id: 'probe',
      name: 'probe',
      description: 'probe',
      appliesTo: () => true,
      generate: async () => [{ id: 's1', description: 's', request: { method: 'POST', url: 'https://t.example/p' } }],
      oracle: async (results, g) => {
        const r = results[0]
        const { verified } = g.verifyClaim(claimFor('probe', r.step.request.url, r.status, r.step.request.method))
        return { confirmed: verified, confidence: verified ? 1 : 0, evidence: [] }
      },
    }
    const res = await runPrimitive(probe, {}, executorFor(() => ({ status: 200 })), gate)
    expect(res.confirmed).toBe(true)
  })

  it('an unbacked claim is still rejected (gate enforces, not blindly true)', () => {
    const { verified } = gate.verifyClaim(claimFor('probe', 'https://t.example/p', 200, 'POST'))
    expect(verified).toBe(false)
  })

  it('classicInjection confirms SQLi when a real error leaks on a non-5xx status', async () => {
    const primitive = getPrimitive('classicInjection') ?? classicInjection
    const ctx = {
      target: 'https://t.example/app',
      endpoint: { url: 'https://t.example/app', method: 'POST' },
    }
    const res = await runPrimitive(
      primitive,
      ctx,
      executorFor(() => ({ status: 200, body: "You have an error in your SQL syntax near ''x''" })),
      gate,
    )
    expect(res.confirmed).toBe(true)
    const verified = gate.verifyClaim(claimFor('sql_injection', 'https://t.example/app', 200, 'POST'))
    expect(verified.verified).toBe(true)
  })

  it('classicInjection detects blind boolean SQLi via response divergence', async () => {
    const primitive = getPrimitive('classicInjection') ?? classicInjection
    const ctx = {
      target: 'https://t.example/app',
      endpoint: { url: 'https://t.example/app', method: 'GET', params: [{ name: 'q', type: 'string' }] },
      param: 'q',
    }
    // True variant: 200 with long body; false variant: 500 with short body.
    const ex = async (step: AttackStep): Promise<StepExecutionResult> => {
      const p = String(step.metadata?.payload ?? '')
      if (p.includes("'1'='1")) return { step, ok: true, status: 200, body: 'normal page content '.repeat(10) }
      if (p.includes("'1'='2")) return { step, ok: true, status: 500, body: 'err' }
      return { step, ok: true, status: 200, body: "You have an error in your SQL syntax near ''x''" }
    }
    const res = await runPrimitive(primitive, ctx, ex, gate)
    expect(res.confirmed).toBe(true)
    expect(res.note ?? '').toContain('sqliHit=true')
  })

  it('headerInjection confirms when an injected header appears in the response', async () => {
    const primitive = getPrimitive('headerInjection') ?? headerInjection
    const ctx = {
      target: 'https://t.example/app',
      endpoint: { url: 'https://t.example/app', method: 'GET' },
    }
    const spy = vi.spyOn(frameworkMod, 'loadPayloads').mockReturnValue({
      all: ['\r\n', 'pwned=1'],
      bySource: { static: ['\r\n', 'pwned=1'], llm: [], merged: ['\r\n', 'pwned=1'] },
      uniqueIds: [],
    } as any)
    try {
      const ex = async (step: AttackStep): Promise<StepExecutionResult> => {
        const hasCrlf = JSON.stringify(step.request.headers ?? {}).includes('\\r\\n')
        return {
          step,
          ok: true,
          status: 200,
          headers: hasCrlf ? { 'set-cookie': 'pwned=1' } : {},
          body: '',
        }
      }
      const res = await runPrimitive(primitive, ctx, ex, gate)
      expect(res.confirmed).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('claimFor produces a structured FindingClaim', () => {
    const claim = claimFor('idor', 'https://t.example/x', 200, 'GET')
    expect(claim).toMatchObject({ type: 'idor', endpoint: 'https://t.example/x', method: 'GET', observed: { status: 200 } })
  })

  it('runPrimitive attaches renderTraces for HTML responses (WS-E)', async () => {
    const probe: TechniquePrimitive = {
      id: 'probe-render',
      name: 'probe-render',
      description: 'probe',
      appliesTo: () => true,
      generate: async () => [
        { id: 's1', description: 's', request: { method: 'GET', url: 'https://t.example/p' }, metadata: { payload: '<b>PAY</b>' } },
      ],
      oracle: async () => ({ confirmed: true, confidence: 1, evidence: [] }),
    }
    const res = await runPrimitive(
      probe,
      {},
      executorFor(() => ({ status: 200, body: '<!doctype html><html><body><input id="q" value="<b>PAY</b>"></body></html>' })),
      gate,
    )
    expect(res.renderTraces?.length ?? 0).toBeGreaterThan(0)
    expect(res.renderTraces?.[0].formFields.some((f) => f.selector === '#q')).toBe(true)
    expect(res.renderTraces?.[0].payloadHits.some((h) => h.selector === '#q')).toBe(true)
  })
})
