/**
 * ldapXpathInjection — LDAP and XPath injection.
 *
 * LDAP: injects filter metacharacters ( ) | & = * ) into a login/query param;
 * confirmed when auth is bypassed (success signal) or a blind differential
 * appears. XPath: injects axis/boolean predicates into an XML query param;
 * confirmed via error leakage or boolean differential. Both reuse the shared
 * observation oracles + EvidenceGate (no hardcoded vocab detection).
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor, assessAccess, loadPayloads } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare } from './observers'
import { getPayloadStore } from '../payloads/store'

function urlWithParam(url: string, param: string, value: string): string {
  try { const u = new URL(url); u.searchParams.set(param, value); return u.toString() } catch { return url }
}

export const ldapXpathInjection: TechniquePrimitive = {
  id: 'ldapXpathInjection',
  name: 'LDAP / XPath Injection',
  description: 'Inject LDAP filter metacharacters and XPath predicates to bypass auth or exfiltrate XML-stored data.',
  technique: 'injection',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.param || ctx.endpoint?.params?.length)
  },
   async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const param = ctx.param ?? ctx.endpoint?.params?.[0]?.name ?? 'user'
    const headers = { ...(ctx.sessionHeaders ?? {}) }

    const steps: AttackStep[] = []

    // Load and merge payloads (static from PayloadStore + LLM-crafted)
    const payloadResult = loadPayloads(ctx)
    const ldapPayloads = payloadResult.bySource.static.length > 0
      ? payloadResult.bySource.static
      : []
    const xpathPayloads = payloadResult.bySource.static.length > 1
      ? payloadResult.bySource.static.slice(1, 10)
      : []
    const ldapErrors = getPayloadStore().getMarkers('ldap/injection')
    ldapPayloads.forEach((p, i) => {
      steps.push({ id: `ldap-${i}`, description: `LDAP bypass into ${param}`, request: { method, url: urlWithParam(url, param, p), headers }, expectedSignal: 'auth bypass / directory error', metadata: { kind: 'ldap', param, payload: p } })
    })
    xpathPayloads.forEach((p, i) => {
      const body = method !== 'GET' ? JSON.stringify({ [param]: p }) : undefined
      steps.push({ id: `xpath-${i}`, description: `XPath injection into ${param}`, request: { method, url: urlWithParam(url, param, p), headers, ...(body ? { body } : {}) }, expectedSignal: 'xpath error / boolean differential', metadata: { kind: 'xpath', param, payload: p } })
    })
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    let ldapHit = false
    let xpathHit = false
    const evidence: PrimitiveResult['evidence'] = []
    const ldapErrors = getPayloadStore().getMarkers('ldap/injection')
    for (const r of results) {
      const kind = r.step.metadata?.kind
      const lower = (r.body ?? '').toLowerCase()
      if (kind === 'ldap') {
        const access = assessAccess({ status: r.status, body: r.body, grantsOn2xx: true })
        const err = ldapErrors.some((m: string) => lower.includes(m))
        if ((access.granted && !access.denied) || err) {
          ldapHit = true
          evidence.push({ kind: 'response', label: `LDAP injection ${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: (r.body ?? '').slice(0, 1000) })
        }
      } else if (kind === 'xpath') {
        const err = ldapErrors.some((m: string) => lower.includes(m))
        if (err) {
          xpathHit = true
          evidence.push({ kind: 'response', label: `XPath injection error ${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: (r.body ?? '').slice(0, 1000) })
        }
      }
    }
    // Blind XPath (boolean) differential as a fallback.
    const xT = results.filter((r) => r.step.metadata?.kind === 'xpath')
    if (xT.length >= 2) {
      const cmp = await observeCompare({ body: xT[0].body ?? '', status: xT[0].status ?? 0 }, { body: xT[1].body ?? '', status: xT[1].status ?? 0 })
      if (cmp.divergence) { xpathHit = true; evidence.push({ kind: 'response', label: `XPath blind differential divergence=${(cmp.divergence ?? 0).toFixed(2)}`, data: '' }) }
    }
    const observed = ldapHit || xpathHit
    const rep = results[0]
    const { verified } = evidenceGate.verifyClaim(claimFor('ldap_xpath_injection', rep?.step.request.url, rep?.status, rep?.step.request.method))
    const confirmed = observed && verified
    return {
      confirmed, confidence: confirmed ? 0.8 : observed ? 0.4 : 0.05, evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed ? { category: 'ldap_xpath_injection', description: `LDAP/XPath injection confirmed on ${rep?.step.request.url} (param ${rep?.step.metadata?.param}).`, cwe: 'CWE-90' } : undefined,
      note: `ldap=${ldapHit} xpath=${xpathHit} verified=${verified}`,
    }
  },
}
