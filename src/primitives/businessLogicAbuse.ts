/**
 * businessLogicAbuse — OWASP BLA Top 10 (2025) coverage:
 *   BLA1 action-limit overrun (e.g. unlimited OTP attempts / no rate limit on
 *        a sensitive action),
 *   BLA4 business-logic flow bypass (skip a required step, e.g. payment before
 *        fulfilment),
 *   BLA7 quota / resource-limit abuse (repeat a rewarded/free action to exhaust
 *        or game a quota).
 *
 * Each is confirmed from structured signals observed in REAL responses (status
 * + body), not vocabulary detection. The "check" for each is caller-supplied as
 * typed data (ctx.state) so the LLM decides over structured facts.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

function urlWithParam(url: string, param: string, value: string): string {
  try { const u = new URL(url); u.searchParams.set(param, value); return u.toString() } catch { return url }
}

export const businessLogicAbuse: TechniquePrimitive = {
  id: 'businessLogicAbuse',
  name: 'Business Logic Abuse (BLA1/4/7)',
  description: 'Detect action-limit overrun, workflow/step-skip, and quota/resource-limit abuse from structured response signals.',
  technique: 'business_logic',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.state?.blaKind)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'POST'
    const kind = String(ctx.state?.blaKind) // 'action_limit' | 'workflow_skip' | 'quota'
    const param = ctx.param ?? 'code'
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const iterations = Number(ctx.state?.iterations ?? 5)
    const steps: AttackStep[] = []

    if (kind === 'action_limit') {
      // Replay the action N times; if all succeed, no limit enforced.
      for (let i = 0; i < iterations; i++) {
        steps.push({ id: `bla-limit-${i}`, description: `Repeat sensitive action #${i} to ${url}`, request: { method, url: urlWithParam(url, param, String(ctx.state?.value ?? '1')), headers }, expectedSignal: 'action succeeded repeatedly without limit', metadata: { kind, index: i, allowed: ctx.state?.allowedCount } })
      }
    } else if (kind === 'workflow_skip') {
      // Jump straight to the "fulfilment" step, skipping the required prior step.
      const skipTo = String(ctx.state?.skipToUrl ?? url)
      steps.push({ id: 'bla-skip', description: `Skip required step → ${skipTo}`, request: { method, url: skipTo, headers, body: ctx.state?.body ? JSON.stringify(ctx.state.body) : undefined }, expectedSignal: 'fulfilment succeeded without prior step', metadata: { kind } })
    } else if (kind === 'quota') {
      for (let i = 0; i < iterations; i++) {
        steps.push({ id: `bla-quota-${i}`, description: `Repeat rewarded action #${i}`, request: { method, url: urlWithParam(url, param, String(i)), headers }, expectedSignal: 'reward granted repeatedly beyond quota', metadata: { kind, index: i } })
      }
    }
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const kind = String(results[0]?.step.metadata?.kind)
    let successCount = 0
    for (const r of results) {
      const ok = (r.status ?? 0) >= 200 && (r.status ?? 0) < 400 && !/limit|too many|exceeded|denied|quota/i.test((r.body ?? '').toLowerCase())
      if (ok) successCount++
    }
    // Abuse confirmed when the action succeeded MORE THAN the allowed count
    // (threshold supplied by the caller as typed data; default 1).
    const allowed = Number((results[0]?.step.metadata as any)?.allowed) || 1
    const observed = successCount > allowed
    const rep = results[0]
    const { verified } = evidenceGate.verifyClaim(claimFor('business_logic_abuse', rep?.step.request.url, rep?.status, rep?.step.request.method))
    const confirmed = observed && verified
    const cwe = kind === 'workflow_skip' ? 'CWE-840' : kind === 'quota' ? 'CWE-770' : 'CWE-799'
    return {
      confirmed, confidence: confirmed ? 0.75 : observed ? 0.4 : 0.05,
      evidence: confirmed ? [{ kind: 'response', label: `${kind}: ${successCount} successes exceed allowed ${allowed}`, data: `first: ${(rep?.body ?? '').slice(0, 800)}` }] : [],
      severity: confirmed ? 'medium' : undefined,
      finding: confirmed ? { category: 'business_logic', description: `Business-logic abuse (${kind}) on ${rep?.step.request.url}: ${successCount} successes vs allowed ${allowed}.`, cwe } : undefined,
      note: `kind=${kind} success=${successCount} allowed=${allowed} verified=${verified}`,
    }
  },
}
