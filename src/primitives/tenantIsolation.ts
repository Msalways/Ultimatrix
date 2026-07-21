/**
 * tenantIsolation — cross-tenant data leakage (multi-tenant BOLA).
 *
 * Using two REAL tenant sessions (tenant A + tenant B, from the session
 * matrix), replays a request for tenant A's resource while authenticated as
 * tenant B. If tenant A's unique marker appears in tenant B's response, tenant
 * isolation is broken. Reuses the same marker-presence logic as detectMarkerLeak
 * (caller-supplied marker; no vocabulary detection).
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

function urlWithId(url: string, id: string): string {
  try { const u = new URL(url); if (u.searchParams.has('id')) u.searchParams.set('id', id); else u.pathname = u.pathname.replace(/\/[^/]+$/, `/${id}`); return u.toString() } catch { return url }
}

export const tenantIsolation: TechniquePrimitive = {
  id: 'tenantIsolation',
  name: 'Tenant Isolation (cross-tenant leak)',
  description: 'Access tenant A\'s resource while authenticated as tenant B; confirm cross-tenant leak via A\'s unique marker in B\'s response.',
  technique: 'authorization',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    // Needs an alternate (attacker) session + a victim object + victim marker.
    return !!(ctx.altSessionHeaders && (ctx.altObjectId || ctx.objectId) && ctx.state?.victimMarker)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    // Attacker = the alternate session; victim resource = altObjectId (owned by victim tenant).
    const attackerHeaders = { ...(ctx.altSessionHeaders ?? {}) }
    const victimResourceId = (ctx.altObjectId ?? ctx.objectId)!
    return [{
      id: 'tenant-cross',
      description: `Access victim tenant resource ${victimResourceId} as attacker tenant`,
      request: { method, url: urlWithId(url, victimResourceId), headers: attackerHeaders },
      expectedSignal: 'victim tenant marker leaked to attacker tenant',
      metadata: { kind: 'cross', victimMarker: ctx.state?.victimMarker, victimResourceId },
    }]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const r = results.find((x) => x.step.metadata?.kind === 'cross')
    if (!r) return { confirmed: false, confidence: 0, evidence: [], note: 'no cross-tenant result' }
    const marker = String(r.step.metadata?.victimMarker ?? '')
    const body = r.body ?? ''
    const leaked = marker.length > 0 && body.toLowerCase().includes(marker.toLowerCase()) && (r.status ?? 0) < 400
    const { verified } = evidenceGate.verifyClaim(claimFor('cross_tenant_leak', r.step.request.url, r.status, r.step.request.method))
    const confirmed = leaked && verified
    return {
      confirmed, confidence: confirmed ? 0.9 : leaked ? 0.5 : 0.05,
      evidence: confirmed ? [{ kind: 'response', label: `cross-tenant leak: victim marker in ${r.step.request.url} → ${r.status}`, data: body.slice(0, 1500) }] : [],
      severity: confirmed ? 'critical' : undefined,
      finding: confirmed ? { category: 'broken_access_control', description: `Cross-tenant data leak on ${r.step.request.url}: victim tenant marker returned to a different tenant.`, cwe: 'CWE-639' } : undefined,
      exploitProof: confirmed ? { scenario: 'Cross-tenant isolation broken', request: `${r.step.request.method} ${r.step.request.url}`, response: `HTTP ${r.status}\n${body.slice(0, 800)}`, impact: 'Attacker tenant retrieved another tenant\'s data (marker present in response).' } : undefined,
      dataArtifact: confirmed ? { kind: 'victim-data', label: `Victim tenant data at ${r.step.request.url}`, data: body.slice(0, 1500) } : undefined,
      note: `leaked=${leaked} verified=${verified}`,
    }
  },
}
