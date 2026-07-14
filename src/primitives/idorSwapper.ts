/**
 * idorSwapper — Insecure Direct Object Reference testing.
 *
 * Accesses an object ID owned by a DIFFERENT user while authenticated as the
 * primary actor. Generator produces a baseline request for the actor's own
 * object and an alternate request swapping in another user's object ID.
 * Oracle: compares responses via compareResponses — if the alternate request
 * succeeds and returns different content (the other user's data), IDOR is confirmed.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare } from './observers'

function swapIdInUrl(url: string, from: string, to: string): string {
  if (!from) return url
  try {
    const u = new URL(url)
    for (const [k, v] of u.searchParams.entries()) {
      if (v === from) u.searchParams.set(k, to)
    }
    return u.toString().replace(from, to)
  } catch {
    return url.replace(from, to)
  }
}

export const idorSwapper: TechniquePrimitive = {
  id: 'idorSwapper',
  name: 'IDOR Object Swapper',
  description: 'Swap object IDs across users to detect Insecure Direct Object References (access to another user\'s data).',
  technique: 'idor',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.objectId && ctx.altObjectId)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const headers = { ...(ctx.sessionHeaders ?? {}) }

    const baseline: AttackStep = {
      id: 'idor-baseline',
      description: `Access own object ${ctx.objectId} at ${url}`,
      request: { method, url, headers },
      metadata: { kind: 'baseline' },
    }

    const swappedUrl = swapIdInUrl(url, ctx.objectId!, ctx.altObjectId!)
    const altBody = method !== 'GET' ? JSON.stringify({ id: ctx.altObjectId }) : undefined

    const alt: AttackStep = {
      id: 'idor-alt',
      description: `Access OTHER user's object ${ctx.altObjectId} at ${swappedUrl}`,
      request: { method, url: swappedUrl, headers, ...(altBody ? { body: altBody } : {}) },
      expectedSignal: 'server returns the other user\'s object data to the actor',
      metadata: { kind: 'alt' },
    }

    return [baseline, alt]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const baseline = results.find(r => r.step.metadata?.kind === 'baseline')
    const alt = results.find(r => r.step.metadata?.kind === 'alt')
    if (!baseline || !alt) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'missing baseline/alt results' }
    }

    const altStatus = alt.status ?? 0
    const altAllowed = altStatus >= 200 && altStatus < 400
    const cmp = await observeCompare(
      { body: baseline.body ?? '', status: baseline.status ?? 0 },
      { body: alt.body ?? '', status: altStatus },
    )
    // Divergent content for a different object ID while still allowed = IDOR.
    const idor = altAllowed && cmp.vulnerable

    const { verified } = evidenceGate.verifyClaim(
      claimFor('idor', baseline.step.request.url, baseline.status, baseline.step.request.method),
    )
    const confirmed = idor && verified

    const evidence = [
      { kind: 'response' as const, label: `baseline (own ${baseline.step.request.url}) → ${baseline.status}`, data: (baseline.body ?? '').slice(0, 1500) },
      { kind: 'response' as const, label: `alt (other ${alt.step.request.url}) → ${altStatus}`, data: (alt.body ?? '').slice(0, 1500) },
    ]

    return {
      confirmed,
      confidence: confirmed ? 0.85 : idor ? 0.5 : 0.1,
      evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed
        ? {
            category: 'idor',
            description: `IDOR on ${baseline.step.request.url}: actor accessed another user's object ${alt.step.request.url} (divergence=${cmp.divergence.toFixed(2)}).`,
            request: alt.step.request,
            response: { status: altStatus, body: (alt.body ?? '').slice(0, 1000) },
            cwe: 'CWE-639',
          }
        : undefined,
      note: `altAllowed=${altAllowed} divergence=${cmp.divergence.toFixed(2)} verified=${verified}`,
    }
  },
}
