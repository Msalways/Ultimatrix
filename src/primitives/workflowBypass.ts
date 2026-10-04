/**
 * workflowBypass — FIRST CLASS
 *
 * Replays the observed terminal request in a learned multi-step flow (e.g.
 * checkout, password reset, payment confirmation). A successful replay is only
 * a candidate because the captured actor may still hold prior workflow state.
 *
 * Generator: an exact replay of the captured terminal request. Oracle: records
 * accepted replays as candidates; a fresh actor/session check is required to
 * prove that prerequisites were actually skipped.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor, assessAccess } from './framework'
import { isWorkflowEndpoint, hasTarget } from './routing'
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
  name: 'Workflow Replay Probe',
  description: 'Replay an observed terminal step in a learned multi-step workflow; accepted responses remain candidates pending fresh actor verification.',
  technique: 'workflow_bypass',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!hasTarget(ctx)) return false
    return isWorkflowEndpoint(ctx) && Boolean(ctx.requestTemplate)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const template = ctx.requestTemplate
    if (!template || (ctx.workflowSteps?.length ?? 0) < 2) return []
    const url = ctx.endpoint?.url ?? ctx.target!
    if (!sameEndpoint(template.url, url)) return []
    const method = template.method.toUpperCase()
    if (ctx.endpoint?.method && method !== ctx.endpoint.method.toUpperCase()) return []
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return []
    return [
      {
        id: 'workflow-terminal-replay',
        description: `Replay the observed terminal request for ${url} without replaying earlier observed steps`,
        request: {
          method,
          url: template.url,
          headers: { ...template.headers },
          ...(template.body !== undefined ? { body: template.body } : {}),
        },
        expectedSignal: 'replay outcome differs in a way that suggests duplicate or out-of-order workflow processing',
        metadata: { kind: 'observed-terminal-replay', workflowId: ctx.state?.workflowId },
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
    const replayAccepted = a.granted && !a.denied

    const { verified } = evidenceGate.verifyClaim(
      claimFor('workflow_bypass', direct.step.request.url, direct.status, direct.step.request.method),
    )
    // The captured actor may already hold server-side workflow state. An
    // accepted replay is therefore a lead, not proof that prerequisites can
    // be skipped. A fresh actor/session comparison must establish that.
    const candidate = replayAccepted && verified

    const evidence = [
      {
        kind: 'response' as const,
        label: `replay ${direct.step.request.method} ${direct.step.request.url} → ${direct.status}`,
        data: (direct.body ?? '').slice(0, 2000),
      },
    ]

    return {
      confirmed: false,
      candidate,
      confidence: candidate ? Math.min(0.6, a.confidence) : 0.1,
      evidence,
      note: candidate
        ? `terminal replay accepted (status=${direct.status}); candidate only because this actor may retain prior workflow state; fresh actor/session verification required`
        : `granted=${a.granted} denied=${a.denied} signals=${a.signals.join(',')} verified=${verified}`,
    }
  },
}

function sameEndpoint(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch { return left === right }
}
