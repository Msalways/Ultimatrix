/**
 * authzMatrix — horizontal / vertical authorization testing.
 *
 * Replays a request with an alternate role/session and compares the two REAL
 * responses via compareResponses. Confirmed when access control fails — either
 * the baseline is denied but the alternate is allowed (vertical/horizontal
 * escalation), or both are allowed but return divergent content for data the
 * alternate actor should not see.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare } from './observers'

export const authzMatrix: TechniquePrimitive = {
  id: 'authzMatrix',
  name: 'Authorization Matrix',
  description: 'Replay a request with an alternate role/session and compare responses to detect broken access control (horizontal/vertical).',
  technique: 'authorization',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.sessionHeaders || ctx.altSessionHeaders || (ctx.roles && ctx.roles.length > 1))
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const baseHeaders = { ...(ctx.sessionHeaders ?? {}) }

    const baseline: AttackStep = {
      id: 'authz-baseline',
      description: `Baseline request as primary actor to ${url}`,
      request: { method, url, headers: baseHeaders },
      metadata: { kind: 'baseline' },
    }

    let altHeaders: Record<string, string>
    if (ctx.altSessionHeaders) {
      altHeaders = { ...ctx.altSessionHeaders }
    } else {
      const altRole = (ctx.roles ?? []).find(r => r !== ctx.role) ?? ctx.role ?? 'admin'
      altHeaders = { ...baseHeaders, 'X-Role': altRole, Role: altRole }
    }

    const alt: AttackStep = {
      id: 'authz-alt',
      description: `Replayed request as alternate actor to ${url}`,
      request: { method, url, headers: altHeaders },
      expectedSignal: 'alternate actor receives different/forbidden access',
      metadata: { kind: 'alt' },
    }

    return [baseline, alt]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const baseline = results.find(r => r.step.metadata?.kind === 'baseline')
    const alt = results.find(r => r.step.metadata?.kind === 'alt')
    if (!baseline || !alt) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'missing baseline/alt results' }
    }

    const baseStatus = baseline.status ?? 0
    const altStatus = alt.status ?? 0
    const cmp = await observeCompare(
      { body: baseline.body ?? '', status: baseStatus },
      { body: alt.body ?? '', status: altStatus },
    )

    const baselineDenied = baseStatus === 401 || baseStatus === 403
    const altAllowed = altStatus >= 200 && altStatus < 400
    const escalated = (baselineDenied && altAllowed) || (cmp.vulnerable && altAllowed)

    const { verified } = evidenceGate.verifyClaim(
      claimFor('broken_access_control', baseline.step.request.url, baseStatus, baseline.step.request.method),
    )
    const confirmed = escalated && verified

    const evidence = [
      { kind: 'response' as const, label: `baseline ${baseline.step.request.method} ${baseline.step.request.url} → ${baseStatus}`, data: (baseline.body ?? '').slice(0, 1500) },
      { kind: 'response' as const, label: `alt ${alt.step.request.method} ${alt.step.request.url} → ${altStatus}`, data: (alt.body ?? '').slice(0, 1500) },
    ]

    return {
      confirmed,
      confidence: confirmed ? 0.85 : escalated ? 0.5 : 0.1,
      evidence,
      severity: confirmed ? (baselineDenied && altAllowed ? 'critical' : 'high') : undefined,
      finding: confirmed
        ? {
            category: 'broken_access_control',
            description: `Broken access control on ${baseline.step.request.url}: baseline ${baseStatus} vs alternate ${altStatus} (divergence=${cmp.divergence.toFixed(2)}).`,
            request: alt.step.request,
            response: { status: altStatus, body: (alt.body ?? '').slice(0, 1000) },
            cwe: 'CWE-285',
          }
        : undefined,
      note: `baseline=${baseStatus} alt=${altStatus} divergence=${cmp.divergence.toFixed(2)} verified=${verified}`,
    }
  },
}
