/**
 * boplaOracle — OWASP Business Logic Abuse: response over-exposure +
 * mass-assignment of protected fields.
 *
 * Replays a request across the real captured identities in the session matrix
 * and inspects the RESPONSE STRUCTURE (a typed field list supplied by the
 * caller / learned schema, never a frozen keyword vocab) to detect:
 *   - response-field over-exposure: a response carries fields the actor's role
 *     should not see (compared against a baseline role's response),
 *   - mass-assignment: a protected field supplied in the request body is
 *     accepted/echoed back in the response (e.g. role=admin).
 *
 * Relation-native: the "forbidden fields" set is DATA passed in ctx, decided by
 * the LLM over structured schema, not regex over prose.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

function _urlWithParam(url: string, param: string, value: string): string {
  try { const u = new URL(url); u.searchParams.set(param, value); return u.toString() } catch { return url }
}

function parseJson(body: string): Record<string, unknown> | null {
  try { return JSON.parse(body) } catch { return null }
}

export const boplaOracle: TechniquePrimitive = {
  id: 'boplaOracle',
  name: 'Business Logic Over-exposure / Mass-Assignment',
  description: 'Detect response-field over-exposure across roles and mass-assignment of protected fields (BOLA/BOPLA).',
  technique: 'business_logic',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.roles && ctx.roles.length > 1) || !!(ctx.sessionHeaders && ctx.altSessionHeaders)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const _param = ctx.param ?? ctx.endpoint?.params?.[0]?.name ?? 'id'
    const steps: AttackStep[] = []
    // Baseline (primary) and alternate (real) identities.
    const primary = ctx.sessionHeaders ?? {}
    const alt = ctx.altSessionHeaders ?? {}
    steps.push({ id: 'bopla-primary', description: `Baseline response as primary to ${url}`, request: { method, url, headers: primary }, metadata: { kind: 'primary' } })
    if (Object.keys(alt).length) {
      steps.push({ id: 'bopla-alt', description: `Response as alternate identity to ${url}`, request: { method, url, headers: alt }, metadata: { kind: 'alt' } })
    }
    // Mass-assignment probe: send protected fields in the body.
    const forbidden = ((ctx.state?.forbiddenFields as string[]) ?? (ctx.payloads ?? []))
    if (forbidden.length > 0) {
      const body = JSON.stringify(Object.fromEntries(forbidden.map((f) => [f, 'admin'])))
      steps.push({
        id: 'bopla-massassign',
        description: `Mass-assignment probe with protected fields to ${url}`,
        request: { method: method === 'GET' ? 'POST' : method, url, headers: primary, body },
        expectedSignal: 'protected field echoed/accepted in response',
        metadata: { kind: 'massassign', fields: forbidden },
      })
    }
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const evidence: PrimitiveResult['evidence'] = []
    const primary = results.find((r) => r.step.metadata?.kind === 'primary')
    const alt = results.find((r) => r.step.metadata?.kind === 'alt')
    const mass = results.find((r) => r.step.metadata?.kind === 'massassign')

    let exposureHit = false
    if (primary && alt) {
      const pb = parseJson(primary.body ?? '') ?? {}
      const ab = parseJson(alt.body ?? '') ?? {}
      const pKeys = new Set(Object.keys(pb))
      const aKeys = new Set(Object.keys(ab))
      const extra = [...aKeys].filter((k) => !pKeys.has(k))
      if (extra.length > 0) {
        exposureHit = true
        evidence.push({ kind: 'response', label: `Response over-exposure: alt has extra fields [${extra.join(', ')}]`, data: (alt.body ?? '').slice(0, 1500) })
      }
    }

    let massHit = false
    if (mass) {
      const forbidden = (mass.step.metadata?.fields as string[]) ?? []
      const mb = parseJson(mass.body ?? '') ?? {}
      const echoed = forbidden.filter((f) => f in mb && String((mb as any)[f]).toLowerCase().includes('admin'))
      if (echoed.length > 0) {
        massHit = true
        evidence.push({ kind: 'response', label: `Mass-assignment accepted protected field(s) [${echoed.join(', ')}]`, data: (mass.body ?? '').slice(0, 1000) })
      }
    }

    const observed = exposureHit || massHit
    const rep = alt ?? mass ?? primary
    const { verified } = evidenceGate.verifyClaim(claimFor('bopla', rep?.step.request.url, rep?.status, rep?.step.request.method))
    const confirmed = observed && verified
    return {
      confirmed, confidence: confirmed ? 0.8 : observed ? 0.4 : 0.05, evidence,
      severity: confirmed ? 'medium' : undefined,
      finding: confirmed ? { category: 'business_logic', description: `Business-logic abuse (over-exposure/mass-assignment) on ${rep?.step.request.url}.`, cwe: 'CWE-639' } : undefined,
      note: `exposure=${exposureHit} massassign=${massHit} verified=${verified}`,
    }
  },
}
