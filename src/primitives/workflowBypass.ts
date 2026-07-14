/**
 * workflowBypass — FIRST CLASS
 *
 * Attempts to skip REQUIRED steps in a multi-step flow (e.g. checkout, password
 * reset, payment confirmation) by directly accessing the terminal endpoint with
 * missing/empty state, and detects whether the server enforces the prerequisite
 * steps (missing-state check bypass).
 *
 * Generator: a direct-access step to the terminal endpoint without the prior
 * flow state. Oracle: inspects the REAL response for success signals vs.
 * required-step / authorization error signals. If the terminal action succeeds
 * without the mandated prior steps, the workflow guard is bypassable.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor, assessAccess } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

const DENY_MARKERS = [
  'unauthorized', 'forbidden', 'login required', 'please log in', 'session expired',
  'step required', 'invalid step', 'complete the', 'missing required', 'csrf', 'token required',
  'not allowed', 'access denied', 'must be', 'precondition', 'out of order', 'incorrect state',
]
const SUCCESS_MARKERS = [
  'success', 'confirmed', 'order placed', 'payment received', 'completed', 'created',
  'redirect', 'updated', 'done', 'your order',
]

export const workflowBypass: TechniquePrimitive = {
  id: 'workflowBypass',
  name: 'Workflow Bypass',
  description: 'Attempt to skip required steps in a multi-step flow by directly accessing the terminal endpoint with missing state.',
  technique: 'workflow_bypass',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    const url = (ctx.endpoint?.url ?? ctx.target ?? '').toLowerCase()
    return (
      (ctx.workflowSteps?.length ?? 0) > 1 ||
      /\/(checkout|confirm|complete|submit|reset|verify|activate|pay|order|transfer|redeem|finalize|upgrade)/.test(url)
    )
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method && ctx.endpoint.method !== 'GET' ? ctx.endpoint.method : 'POST'
    return [
      {
        id: 'workflow-direct-access',
        description: `Directly access terminal endpoint ${url} without performing prior flow steps`,
        request: {
          method,
          url,
          headers: { ...(ctx.sessionHeaders ?? { 'Content-Type': 'application/json' }) },
          ...(method !== 'GET' ? { body: JSON.stringify({ __workflow_probe: true }) } : {}),
        },
        expectedSignal: 'server accepts the action without enforcing prior required steps',
        metadata: { kind: 'direct' },
      },
    ]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const direct = results[0]
    if (!direct) return { confirmed: false, confidence: 0, evidence: [], note: 'no result' }

    // Behavioral, status-authoritative verdict (keyword markers are a secondary
    // signal only — see assessAccess). A custom denial/success page that does
    // not contain the literal English markers is still correctly assessed.
    const a = assessAccess({
      status: direct.status,
      body: direct.body,
      denyMarkers: DENY_MARKERS,
      successMarkers: SUCCESS_MARKERS,
    })
    const bypassed = a.granted && !a.denied

    const { verified } = evidenceGate.verifyClaim(
      claimFor('workflow_bypass', direct.step.request.url, direct.status, direct.step.request.method),
    )
    const confirmed = bypassed && verified

    const evidence = [
      {
        kind: 'response' as const,
        label: `direct ${direct.step.request.method} ${direct.step.request.url} → ${direct.status}`,
        data: (direct.body ?? '').slice(0, 2000),
      },
    ]

    return {
      confirmed,
      confidence: confirmed ? Math.max(0.8, a.confidence) : bypassed ? a.confidence : 0.1,
      evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed
        ? {
            category: 'workflow_bypass',
            description: `Required-step workflow guard missing on ${direct.step.request.url}: terminal action succeeded without prior steps (status ${direct.status}).`,
            request: direct.step.request,
            response: { status: direct.status ?? 0, body: (direct.body ?? '').slice(0, 1000) },
            cwe: 'CWE-841',
          }
        : undefined,
      note: `granted=${a.granted} denied=${a.denied} signals=${a.signals.join(',')} verified=${verified}`,
    }
  },
}
