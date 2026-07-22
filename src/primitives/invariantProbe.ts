/**
 * invariantProbe — probes an endpoint to confirm whether a derived behavioral
 * invariant holds, or can be violated by tampering with a request parameter.
 *
 * Generator: baseline request + a mutated request that attempts to break the
 * invariant (e.g. blank a required field, flip a boolean, inject a bypass token).
 * Oracle: compares the two REAL responses via compareResponses — if the server
 * returns equivalent content for the mutated request, the invariant is not
 * enforced.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare, observeParse } from './observers'
import { mutationsFor, type RelationSeed } from './constraint-mutators'
import { getPayloadStore } from '../payloads/store'

const BYPASS_TOKENS = () => {
  const tokens = getPayloadStore().getPayloads('authz/bypass-tokens', 'authz_bypass_tokens')
  return tokens.length > 0 ? tokens : ['', 'bypass', '0', 'null', 'true', 'admin', '../', '1=1']
}

/** Build a mutated step for one relation-seeded mutation (foreign/omit/boundary). */
function mutationToStep(seed: RelationSeed, mutation: ReturnType<typeof mutationsFor>[number], url: string, method: string, baseHeaders: Record<string, string>): AttackStep {
  let target = url
  let body: string | undefined
  const apply = (u: URL) => {
    if (mutation.kind === 'omit') u.searchParams.delete(mutation.param)
    else u.searchParams.set(mutation.param, mutation.value)
  }
  try {
    const u = new URL(target)
    apply(u)
    target = u.toString()
  } catch {
    body = mutation.kind === 'omit' ? '' : `${encodeURIComponent(mutation.param)}=${encodeURIComponent(mutation.value)}`
  }
  return {
    id: `invariant-seed-${mutation.kind}-${mutation.param}`,
    description: `Relation-seeded mutation (${mutation.kind}) on ${seed.sinkParam}: ${mutation.note}`,
    request: { method, url: target, headers: baseHeaders, ...(body ? { body } : {}) },
    expectedSignal: 'server returns equivalent/allowed response for tampered input',
    metadata: { kind: 'mutated', relationSeed: seed.relationType },
  }
}

export const invariantProbe: TechniquePrimitive = {
  id: 'invariantProbe',
  name: 'Invariant Probe',
  description: 'Attempt to violate a derived behavioral invariant (required field, state check, or access rule) by tampering with the request.',
  technique: 'invariant',
  appliesTo(ctx: TechniqueContext): boolean {
    return !!(ctx.endpoint || ctx.target)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const baseHeaders = { ...(ctx.sessionHeaders ?? {}) }
    const param = ctx.param

    const baseline: AttackStep = {
      id: 'invariant-baseline',
      description: `Baseline request to ${url}`,
      request: { method, url, headers: baseHeaders },
      metadata: { kind: 'baseline' },
    }

    // Relation-seeded path: concrete mutations derived from a discovered graph
    // relation (e.g. a value re-ingested across endpoints).
    if (ctx.relationSeed) {
      const seed = ctx.relationSeed
      const mutated = mutationsFor(seed).map((m) => mutationToStep(seed, m, url, method, baseHeaders))
      return [baseline, ...mutated]
    }

    let mutatedUrl = url
    let body: string | undefined
    const token = BYPASS_TOKENS()[0]
    if (param) {
      try {
        const u = new URL(mutatedUrl)
        u.searchParams.set(param, token)
        mutatedUrl = u.toString()
      } catch {
        body = `${encodeURIComponent(param)}=${encodeURIComponent(token)}`
      }
    } else {
      try {
        const u = new URL(mutatedUrl)
        u.searchParams.set('__invariant_probe', 'bypass')
        mutatedUrl = u.toString()
      } catch {
        body = '__invariant_probe=bypass'
      }
    }

    const mutated: AttackStep = {
      id: 'invariant-mutated',
      description: `Mutated request attempting to break the invariant on ${url}`,
      request: { method: method === 'GET' ? 'GET' : method, url: mutatedUrl, headers: baseHeaders, ...(body ? { body } : {}) },
      expectedSignal: 'server returns equivalent/allowed response for tampered input',
      metadata: { kind: 'mutated' },
    }

    return [baseline, mutated]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const baseline = results.find(r => r.step.metadata?.kind === 'baseline')
    const mutated = results.find(r => r.step.metadata?.kind === 'mutated')
    if (!baseline || !mutated) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'missing baseline/mutated results' }
    }
    const baseBody = baseline.body ?? ''
    const mutBody = mutated.body ?? ''
    const cmp = await observeCompare(
      { body: baseBody, status: baseline.status ?? 0 },
      { body: mutBody, status: mutated.status ?? 0 },
    )

    const tamperedAllowed = cmp.vulnerable || (baseline.status === mutated.status && baseline.status !== undefined && baseline.status < 400)
    const { verified } = evidenceGate.verifyClaim(
      claimFor('invariant', baseline.step.request.url, baseline.status, baseline.step.request.method),
    )
    const confirmed = tamperedAllowed && verified

    await observeParse(mutBody, mutated.headers ?? {}, mutated.status ?? 0)

    const evidence = [
      { kind: 'response' as const, label: `baseline ${baseline.step.request.method} ${baseline.step.request.url} → ${baseline.status}`, data: baseBody.slice(0, 2000) },
      { kind: 'response' as const, label: `mutated ${mutated.step.request.method} ${mutated.step.request.url} → ${mutated.status}`, data: mutBody.slice(0, 2000) },
    ]

    return {
      confirmed,
      confidence: confirmed ? 0.75 : cmp.divergence > 0.2 ? 0.4 : 0.1,
      evidence,
      severity: confirmed ? 'medium' : undefined,
      finding: confirmed
        ? {
            category: 'broken_access_control',
            description: `Invariant on ${baseline.step.request.url} can be violated: mutated request returned equivalent response (divergence=${cmp.divergence.toFixed(2)}).`,
            request: baseline.step.request,
            response: { status: mutated.status ?? 0, body: mutBody.slice(0, 1000) },
            cwe: 'CWE-840',
          }
        : undefined,
      note: `divergence=${cmp.divergence.toFixed(2)} vulnerable=${cmp.vulnerable} verified=${verified}`,
    }
  },
}
