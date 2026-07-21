/**
 * artifactLifetime — stale/revoked artifact replay (OWASP BLA "Artifact Lifetime").
 *
 * Replays a request with a token/session that SHOULD be invalid (expired,
 * revoked, or post-logout) and confirms the server still honours it. The
 * "invalid" artifact is supplied by the caller (ctx.state.staleHeaders) — a
 * real captured-then-invalidated credential — never a spoofed value.
 *
 * Confirmed when the stale artifact yields authorized access (granted signal)
 * AND the claim is backed by a recorded evidence item.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor, assessAccess } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

export const artifactLifetime: TechniquePrimitive = {
  id: 'artifactLifetime',
  name: 'Artifact Lifetime (stale token replay)',
  description: 'Replay an expired/revoked/post-logout session or token and confirm the server still grants access.',
  technique: 'business_logic',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.state?.staleHeaders) || !!ctx.altSessionHeaders
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const stale = (ctx.state?.staleHeaders as Record<string, string>) ?? ctx.altSessionHeaders ?? {}
    const fresh = ctx.sessionHeaders ?? {}
    const steps: AttackStep[] = []
    // Fresh baseline (to know what a granted response looks like) if available.
    if (Object.keys(fresh).length) {
      steps.push({ id: 'lifetime-fresh', description: `Fresh session baseline to ${url}`, request: { method, url, headers: fresh }, metadata: { kind: 'fresh' } })
    }
    steps.push({
      id: 'lifetime-stale',
      description: `Replay stale/revoked artifact to ${url}`,
      request: { method, url, headers: stale },
      expectedSignal: 'stale artifact still granted access',
      metadata: { kind: 'stale' },
    })
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const stale = results.find((r) => r.step.metadata?.kind === 'stale')
    if (!stale) return { confirmed: false, confidence: 0, evidence: [], note: 'no stale replay result' }
    const access = assessAccess({ status: stale.status, body: stale.body, setCookie: stale.headers?.['set-cookie'], grantsOn2xx: true })
    const granted = access.granted && !access.denied
    const { verified } = evidenceGate.verifyClaim(claimFor('stale_artifact', stale.step.request.url, stale.status, stale.step.request.method))
    const confirmed = granted && verified
    return {
      confirmed, confidence: confirmed ? 0.85 : granted ? 0.4 : 0.05,
      evidence: [{ kind: 'response', label: `stale artifact ${stale.step.request.method} ${stale.step.request.url} → ${stale.status} [${access.signals.join(',')}]`, data: (stale.body ?? '').slice(0, 1200) }],
      severity: confirmed ? 'high' : undefined,
      finding: confirmed ? { category: 'business_logic', description: `Stale/revoked artifact still grants access on ${stale.step.request.url}.`, cwe: 'CWE-613' } : undefined,
      note: `granted=${granted} signals=${access.signals.join(',')} verified=${verified}`,
    }
  },
}
