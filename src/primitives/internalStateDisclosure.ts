/**
 * internalStateDisclosure — valid-vs-invalid response differential leakage
 * (OWASP BLA "Internal Process / State Disclosure").
 *
 * Sends the same request with a VALID vs an INVALID/garbage identifier and
 * compares the two responses. Apps that reveal internal state (stack traces,
 * internal ids, exception class names, SQL/query fragments, environment
 * secrets) on the invalid path leak more than a neutral 404 — proving
 * information disclosure that aids an attacker.
 *
 * Differential is computed with the shared compare oracle; internal-state
 * signatures are DATA, not a vocabulary detector in the prompt.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare } from './observers'

const STATE_MARKERS = ['stack trace', 'exception', 'traceback', 'at com.', 'java.lang', 'sqlstate', 'query', 'internal', 'debug', 'caused by', 'TypeError', 'undefined index', 'nginx', 'apache', 'redis', 'rabbitmq']

function urlWithId(url: string, id: string): string {
  try { const u = new URL(url); if (u.searchParams.has('id')) u.searchParams.set('id', id); else u.pathname = u.pathname.replace(/\/[^/]+$/, `/${id}`); return u.toString() } catch { return url }
}

export const internalStateDisclosure: TechniquePrimitive = {
  id: 'internalStateDisclosure',
  name: 'Internal State Disclosure',
  description: 'Compare valid vs invalid identifier responses to detect internal-state / debug info leakage.',
  technique: 'information_disclosure',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!ctx.objectId || !!(ctx.endpoint?.params?.length)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const valid = ctx.objectId ?? '1'
    const invalid = ctx.state?.invalidId ?? '00000000-0000-0000-0000-000000000000'
    const steps: AttackStep[] = [
      { id: 'state-valid', description: `Valid id request to ${url}`, request: { method, url: urlWithId(url, valid), headers }, metadata: { kind: 'valid' } },
      { id: 'state-invalid', description: `Invalid id request to ${url}`, request: { method, url: urlWithId(url, invalid), headers }, metadata: { kind: 'invalid' } },
    ]
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const valid = results.find((r) => r.step.metadata?.kind === 'valid')
    const invalid = results.find((r) => r.step.metadata?.kind === 'invalid')
    if (!valid || !invalid) return { confirmed: false, confidence: 0, evidence: [], note: 'missing valid/invalid results' }
    const cmp = await observeCompare({ body: valid.body ?? '', status: valid.status ?? 0 }, { body: invalid.body ?? '', status: invalid.status ?? 0 })
    const lower = (invalid.body ?? '').toLowerCase()
    const leaked = STATE_MARKERS.some((m) => lower.includes(m))
    const observed = leaked && (cmp.divergent || (invalid.status ?? 0) >= 500)
    const { verified } = evidenceGate.verifyClaim(claimFor('internal_state_disclosure', invalid.step.request.url, invalid.status, invalid.step.request.method))
    const confirmed = observed && verified
    return {
      confirmed, confidence: confirmed ? 0.75 : observed ? 0.4 : 0.05,
      evidence: confirmed ? [{ kind: 'response', label: `invalid-id response leaks internal state ${invalid.step.request.url} → ${invalid.status}`, data: (invalid.body ?? '').slice(0, 1500) }] : [],
      severity: confirmed ? 'medium' : undefined,
      finding: confirmed ? { category: 'information_disclosure', description: `Internal state disclosed on invalid identifier at ${invalid.step.request.url}.`, cwe: 'CWE-209' } : undefined,
      note: `divergent=${cmp.divergent} leaked=${leaked} verified=${verified}`,
    }
  },
}
