/**
 * concurrencyHarness — FIRST CLASS
 *
 * Race-condition harness. Fires N concurrent identical requests against a
 * state-changing endpoint and compares the REAL responses via compareResponses
 * to detect TOCTOU / race conditions (e.g. double-spend, duplicate creation,
 * privilege grant, counter drift).
 *
 * The steps are marked `metadata.concurrent` so runPrimitive executes them in
 * parallel (Promise.all); the oracle then compares each response against the
 * baseline to surface divergent outcomes.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare } from './observers'

const DEFAULT_ITERATIONS = 10

export const concurrencyHarness: TechniquePrimitive = {
  id: 'concurrencyHarness',
  name: 'Concurrency / Race Harness',
  description: 'Fire N concurrent identical requests at a state-changing endpoint and compare responses to detect race/TOCTOU conditions.',
  technique: 'race_condition',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    const url = (ctx.endpoint?.url ?? ctx.target ?? '').toLowerCase()
    const method = (ctx.endpoint?.method ?? 'POST').toUpperCase()
    return (
      method !== 'GET' &&
      /(transfer|redeem|coupon|discount|withdraw|order|payment|credit|balance|stock|inventory|register|create|subscribe|upgrade|vote|claim|book|reserve)/.test(url)
    )
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method && ctx.endpoint.method !== 'GET' ? ctx.endpoint.method : 'POST'
    const iterations = (ctx.state?.iterations as number) ?? DEFAULT_ITERATIONS
    const baseHeaders = { ...(ctx.sessionHeaders ?? { 'Content-Type': 'application/json' }) }
    const body = ctx.state?.body as string | undefined

    const steps: AttackStep[] = []
    for (let i = 0; i < iterations; i++) {
      steps.push({
        id: `race-${i}`,
        description: `Concurrent request #${i + 1} to ${url}`,
        request: {
          method,
          url,
          headers: baseHeaders,
          ...(body || method !== 'GET' ? { body: body ?? JSON.stringify({ __race_probe: i }) } : {}),
        },
        expectedSignal: 'at least one response diverges from the others (race condition)',
        metadata: { concurrent: true, iteration: i },
      })
    }
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    if (results.length < 2) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'insufficient concurrent responses' }
    }

    const baseline = results[0]
    let divergent = 0
    let maxDivergence = 0
    const divergentSamples: string[] = []

    for (let i = 1; i < results.length; i++) {
      const r = results[i]
      const cmp = await observeCompare(
        { body: baseline.body ?? '', status: baseline.status ?? 0 },
        { body: r.body ?? '', status: r.status ?? 0 },
      )
      if (cmp.vulnerable || cmp.divergence > 0.2) {
        divergent++
        divergentSamples.push(`#${i} status=${r.status} divergence=${cmp.divergence.toFixed(2)}`)
      }
      maxDivergence = Math.max(maxDivergence, cmp.divergence)
    }

    const raced = divergent > 0
    const { verified } = evidenceGate.verifyClaim(
      claimFor('race_condition', baseline.step.request.url, baseline.status, baseline.step.request.method),
    )
    const confirmed = raced && verified

    const evidence = results.map(r => ({
      kind: 'response' as const,
      label: `${r.step.request.method} ${r.step.request.url} (iter ${r.step.metadata?.iteration}) → ${r.status}`,
      data: (r.body ?? '').slice(0, 800),
    }))

    return {
      confirmed,
      confidence: confirmed ? 0.7 : raced ? 0.4 : 0.1,
      evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed
        ? {
            category: 'race_condition',
            description: `Race condition on ${baseline.step.request.url}: ${divergent}/${results.length - 1} concurrent responses diverged (maxDivergence=${maxDivergence.toFixed(2)}). ${divergentSamples.slice(0, 5).join('; ')}`,
            request: baseline.step.request,
            response: { status: baseline.status ?? 0, body: (baseline.body ?? '').slice(0, 1000) },
            cwe: 'CWE-362',
          }
        : undefined,
      note: `divergent=${divergent}/${results.length - 1} maxDivergence=${maxDivergence.toFixed(2)} verified=${verified}`,
    }
  },
}
