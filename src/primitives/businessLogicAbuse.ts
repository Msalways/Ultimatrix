/**
 * Bounded action-limit and quota checks. A probe replays an observed request;
 * it never invents a parameter or a default limit. A 2xx response is a
 * candidate signal only. Confirmation requires a target-stated rule, an
 * independently captured baseline value, and a response showing that the
 * (allowedCount + 1)th action changed that state.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

type AbuseKind = 'action_limit' | 'quota'

function isFiniteInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function sameTargetPath(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch {
    return false
  }
}

function sameOrigin(left: string, right: string): boolean {
  try { return new URL(left).origin === new URL(right).origin } catch { return false }
}

function validContext(ctx: TechniqueContext): boolean {
  const target = ctx.endpoint?.url ?? ctx.target
  const template = ctx.requestTemplate
  const state = ctx.state
  if (!target || !template || !state || !ctx.capturedRequestId) return false
  if (!['action_limit', 'quota'].includes(String(state.blaKind))) return false
  if (!sameTargetPath(target, template.url)) return false
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(template.method.toUpperCase())) return false
  if (!isFiniteInteger(state.allowedCount, 0, 9)) return false
  if (!isFiniteInteger(state.iterations, state.allowedCount + 1, 10)) return false
  if (typeof state.ruleEvidenceUrl !== 'string' || typeof state.ruleText !== 'string' || state.ruleText.trim().length < 8) return false
  if (typeof state.baselineUrl !== 'string' || typeof state.stateKey !== 'string') return false
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(state.stateKey)) return false
  if (typeof state.baselineValue !== 'number' || !Number.isFinite(state.baselineValue)) return false
  return sameOrigin(target, state.ruleEvidenceUrl) && sameOrigin(target, state.baselineUrl)
}

function numericField(body: string | undefined, key: string): number | undefined {
  if (!body) return undefined
  try {
    const value = (JSON.parse(body) as Record<string, unknown>)[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ruleIsObserved(gate: EvidenceGate, url: string, statement: string): boolean {
  return gate.verifyClaim({
    type: 'business_logic_rule',
    endpoint: url,
    observed: { bodySignature: { type: 'contains', pattern: statement } },
  }).verified
}

function baselineIsObserved(gate: EvidenceGate, url: string, key: string, value: number): boolean {
  const pattern = `"${escapeRegExp(key)}"\\s*:\\s*${escapeRegExp(String(value))}(?![\\d.])`
  return gate.verifyClaim({
    type: 'business_logic_baseline',
    endpoint: url,
    observed: { bodySignature: { type: 'regex', pattern } },
  }).verified
}

export const businessLogicAbuse: TechniquePrimitive = {
  id: 'businessLogicAbuse',
  name: 'Business Logic Abuse (BLA1/7)',
  description: 'Replay an observed state-changing request against an explicitly observed action limit or quota.',
  technique: 'business_logic',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!validContext(ctx)) return false
    const gate = new EvidenceGate()
    return ruleIsObserved(gate, String(ctx.state!.ruleEvidenceUrl), String(ctx.state!.ruleText))
      && baselineIsObserved(gate, String(ctx.state!.baselineUrl), String(ctx.state!.stateKey), Number(ctx.state!.baselineValue))
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    if (!validContext(ctx)) return []
    const template = ctx.requestTemplate!
    const state = ctx.state!
    const kind = state.blaKind as AbuseKind
    const allowedCount = state.allowedCount as number
    const iterations = state.iterations as number
    const templateHeaders = Object.fromEntries(Object.entries(template.headers ?? {})
      .filter(([name]) => !/^(authorization|cookie)$/i.test(name)))
    const headers = { ...templateHeaders, ...(ctx.sessionHeaders ?? {}) }

    return Array.from({ length: iterations }, (_, index): AttackStep => ({
      id: `bla-${kind}-${index + 1}`,
      description: `Replay captured ${kind} action ${index + 1} of ${iterations}`,
      request: {
        method: template.method,
        url: template.url,
        headers,
        ...(template.body !== undefined ? { body: template.body } : {}),
      },
      expectedSignal: `The action beyond the observed limit of ${allowedCount} changes ${String(state.stateKey)}`,
      metadata: {
        kind, index, allowedCount, stateKey: state.stateKey,
        ruleEvidenceUrl: state.ruleEvidenceUrl, ruleText: state.ruleText,
        baselineUrl: state.baselineUrl, baselineValue: state.baselineValue,
      },
    }))
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const first = results[0]
    const kind = String(first?.step.metadata?.kind ?? 'action_limit') as AbuseKind
    const allowedCount = Number(first?.step.metadata?.allowedCount)
    const stateKey = String(first?.step.metadata?.stateKey ?? '')
    const successful = results.filter(result => result.ok && (result.status ?? 0) >= 200 && (result.status ?? 0) < 300)
    const overLimit = results[allowedCount]
    const priorAllowed = allowedCount === 0
      ? Number((first?.step.metadata as Record<string, unknown> | undefined)?.baselineValue)
      : numericField(results[allowedCount - 1]?.body, stateKey)
    const overLimitValue = numericField(overLimit?.body, stateKey)
    const stateChangedBeyondLimit = overLimitValue !== undefined
      && priorAllowed !== undefined
      && overLimitValue !== priorAllowed
    const ruleUrl = String((first?.step.metadata as Record<string, unknown> | undefined)?.ruleEvidenceUrl ?? '')
    const ruleText = String((first?.step.metadata as Record<string, unknown> | undefined)?.ruleText ?? '')
    const baselineUrl = String((first?.step.metadata as Record<string, unknown> | undefined)?.baselineUrl ?? '')
    const baselineValue = Number((first?.step.metadata as Record<string, unknown> | undefined)?.baselineValue)
    const ruleVerified = ruleIsObserved(evidenceGate, ruleUrl, ruleText)
    const baselineVerified = baselineIsObserved(evidenceGate, baselineUrl, stateKey, baselineValue)
    const attackVerified = overLimit?.status !== undefined && evidenceGate.verifyClaim(
      claimFor('business_logic_abuse', overLimit.step.request.url, overLimit.status, overLimit.step.request.method),
    ).verified
    const actionExceededLimit = successful.length > allowedCount && overLimit?.ok === true
      && (overLimit.status ?? 0) >= 200 && (overLimit.status ?? 0) < 300
    const confirmed = actionExceededLimit && stateChangedBeyondLimit && ruleVerified && baselineVerified && attackVerified
    const requestEvidence = results.filter(result => result.status !== undefined).map(result => ({
      kind: 'response' as const,
      label: `${result.step.request.method} ${result.step.request.url} → ${result.status}`,
      data: (result.body ?? '').slice(0, 1200),
      ...(typeof result.extra?.evidenceId === 'string' ? { evidenceId: result.extra.evidenceId } : {}),
    }))

    return {
      confirmed,
      candidate: actionExceededLimit && !confirmed,
      confidence: confirmed ? 0.9 : actionExceededLimit ? 0.45 : 0.05,
      evidence: requestEvidence,
      severity: confirmed ? 'medium' : undefined,
      finding: confirmed ? {
        category: 'business_logic',
        description: `Business-logic abuse (${kind}) on ${overLimit!.step.request.url}: the action beyond the observed limit changed ${stateKey} from ${priorAllowed} to ${overLimitValue}.`,
        request: overLimit!.step.request,
        response: { status: overLimit!.status ?? 0, body: (overLimit!.body ?? '').slice(0, 1000) },
        cwe: kind === 'quota' ? 'CWE-770' : 'CWE-799',
      } : undefined,
      note: `kind=${kind} successes=${successful.length} allowed=${allowedCount} stateChanged=${stateChangedBeyondLimit} ruleVerified=${ruleVerified} baselineVerified=${baselineVerified} attackVerified=${attackVerified}`,
    }
  },
}
