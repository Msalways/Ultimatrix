/**
 * configTrust — detects server trust of client-supplied control values
 * (roles, prices, flags, discounts, amounts) that should be enforced server-side.
 *
 * Generator: replays the request with a tampered control field (e.g. role=admin,
 * price=0, isAdmin=true, discount=100). Oracle: compares the mutated response
 * to the baseline; if the server honors the privileged value (divergent, still
 * successful response), the value is trusted client-side.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare } from './observers'
import { getTechniqueRegistry } from '../skills/technique-registry'

const TRUST_FIELDS = ['role', 'isadmin', 'admin', 'isAdmin', 'price', 'amount', 'discount', 'total', 'quantity', 'vip', 'plan', 'tier', 'verified', 'paid']
const PRIVILEGED_VALUES: Record<string, string[]> = {
  role: ['admin', 'administrator', 'root', 'superuser'],
  isadmin: ['true', '1', 'yes'],
  admin: ['true', '1'],
  isAdmin: ['true', '1'],
  price: ['0', '-1', '0.01'],
  amount: ['0', '-1'],
  discount: ['100', '99', '100%'],
  total: ['0'],
  vip: ['true', '1'],
  verified: ['true', '1'],
  paid: ['true', '1'],
  plan: ['enterprise', 'premium', 'pro'],
  tier: ['enterprise', 'premium', 'pro'],
  quantity: ['-1', '0'],
}

function pickField(ctx: TechniqueContext): string {
  const registry = getTechniqueRegistry()
  // Prefer a param the registry classifies as role/sensitive.
  const param = ctx.param
  if (param && (registry.categorizeField(param) === 'role' || registry.categorizeField(param) === 'sensitive')) {
    return param
  }
  for (const f of TRUST_FIELDS) {
    if (param && param.toLowerCase().includes(f)) return param
    if (ctx.endpoint?.params?.some(p => p.name.toLowerCase().includes(f))) return f
  }
  return param ?? TRUST_FIELDS[0]
}

export const configTrust: TechniquePrimitive = {
  id: 'configTrust',
  name: 'Client-Controlled Value Trust',
  description: 'Detect server trust of client-supplied control values (roles, prices, flags, discounts) that should be enforced server-side.',
  technique: 'business_logic',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.param || ctx.endpoint?.params?.length || ctx.state?.body)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method && ctx.endpoint.method !== 'GET' ? ctx.endpoint.method : 'POST'
    const field = pickField(ctx)
    const values = PRIVILEGED_VALUES[field.toLowerCase()] ?? ['admin', '0', 'true']

    const baseHeaders = { ...(ctx.sessionHeaders ?? { 'Content-Type': 'application/json' }), ...(ctx.altSessionHeaders ?? {}) }

    const baseline: AttackStep = {
      id: 'configtrust-baseline',
      description: `Baseline request to ${url}`,
      request: { method, url, headers: baseHeaders, ...(method !== 'GET' ? { body: ctx.state?.body as string ?? '' } : {}) },
      metadata: { kind: 'baseline' },
    }

    const mutatedUrl = (() => {
      try {
        const u = new URL(url)
        u.searchParams.set(field, values[0])
        return u.toString()
      } catch {
        return url
      }
    })()
    const mutatedBody = method !== 'GET'
      ? JSON.stringify({ ...(ctx.state?.body ? safeJson(ctx.state.body) : {}), [field]: values[0] })
      : undefined

    const mutated: AttackStep = {
      id: 'configtrust-mutated',
      description: `Request to ${url} with tampered control field ${field}=${values[0]}`,
      request: { method, url: mutatedUrl, headers: baseHeaders, ...(mutatedBody ? { body: mutatedBody } : {}) },
      expectedSignal: 'server honors privileged client-supplied value',
      metadata: { kind: 'mutated', field, value: values[0] },
    }

    return [baseline, mutated]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const baseline = results.find(r => r.step.metadata?.kind === 'baseline')
    const mutated = results.find(r => r.step.metadata?.kind === 'mutated')
    if (!baseline || !mutated) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'missing baseline/mutated results' }
    }

    const cmp = await observeCompare(
      { body: baseline.body ?? '', status: baseline.status ?? 0 },
      { body: mutated.body ?? '', status: mutated.status ?? 0 },
    )
    const mutatedOk = (mutated.status ?? 500) >= 200 && (mutated.status ?? 500) < 400
    const privilegedHonored = cmp.vulnerable && mutatedOk

    const { verified } = evidenceGate.verifyClaim(
      claimFor('config_trust', baseline.step.request.url, baseline.status, baseline.step.request.method),
    )
    const confirmed = privilegedHonored && verified

    const evidence = [
      { kind: 'response' as const, label: `baseline ${baseline.step.request.method} ${baseline.step.request.url} → ${baseline.status}`, data: (baseline.body ?? '').slice(0, 1500) },
      { kind: 'response' as const, label: `mutated ${mutated.step.request.method} ${mutated.step.request.url} (${mutated.step.metadata?.field}=${mutated.step.metadata?.value}) → ${mutated.status}`, data: (mutated.body ?? '').slice(0, 1500) },
    ]

    return {
      confirmed,
      confidence: confirmed ? 0.8 : privilegedHonored ? 0.45 : 0.1,
      evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed
        ? {
            category: 'business_logic',
            description: `Server trusts client-supplied value "${String(mutated.step.metadata?.field)}=${String(mutated.step.metadata?.value)}" on ${baseline.step.request.url} (divergence=${cmp.divergence.toFixed(2)}).`,
            request: mutated.step.request,
            response: { status: mutated.status ?? 0, body: (mutated.body ?? '').slice(0, 1000) },
            cwe: 'CWE-602',
          }
        : undefined,
      note: `divergence=${cmp.divergence.toFixed(2)} mutatedOk=${mutatedOk} verified=${verified}`,
    }
  },
}

function safeJson(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return {} }
  }
  return (v as Record<string, unknown>) ?? {}
}
