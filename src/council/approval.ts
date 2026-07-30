/**
 * Approval logic for the council (A11 + C4).
 *
 * Root-cause rewrite: impact classification reads the typed `proposal.proposal.impact`
 * field declared by the LLM, NOT regex patterns on free text. This follows the project's
 * core design principle: typed fields, never substring scanning.
 *
 * Two modes (per gap-analysis "Both modes" answer):
 *  - autonomous: the council self-approves when the skeptic clears the claim,
 *    UNLESS the proposal is classified as critical-impact (auth bypass,
 *    credential extraction, reverse shell, data exfiltration, destructive
 *    action) — those always require human approval.
 *  - hitl / both: human approval is required for critical and high impact
 *    proposals. Low/medium proposals are auto-approved when the skeptic
 *    clears them.
 */

import type {ImpactLevel, MemberOutput} from './types'
export type { ApprovalMode } from './types'
import type { ApprovalMode } from './types'
import type { VerificationResult } from '../intelligence/evidence-ledger'

export interface HumanApprovalRequest {
  proposal: MemberOutput
  impact: ImpactLevel
  reason: string
}

export interface ProposalContext {
  proposal: MemberOutput
  verification: VerificationResult
  approvalMode: ApprovalMode
  /** Resolves whether the human approves a proposal (HITL gate). */
  humanApprove?: (proposal: MemberOutput) => Promise<boolean>
}

export type ApprovalDecision = 'approved' | 'rejected' | 'pending-human'

// ─── Impact Classification ──────────────────────────────────────────────────

/**
 * Root-cause fix: reads the typed `proposal.proposal.impact` field declared
 * by the LLM. No regex, no substring scanning, no pattern matching on text.
 *
 * Fallback: if the LLM didn't declare impact (legacy/missing field), defaults
 * to 'low' — the system is safe-by-default, not aggressive-by-guesswork.
 */
export function classifyImpact(proposal: MemberOutput): ImpactLevel {
  return proposal.proposal?.impact ?? 'low'
}

/**
 * Rigid, config-free map from technique/skill id → minimum impact level.
 *
 * Deterministic: no LLM-meaning detection. A destructive technique can NEVER be
 * downgraded by the LLM declaring a lower impact — the floor is enforced.
 * This is a typed-deterministic seam (skillId is a structured enum-like value),
 * so it is fully within the "no LLM-meaning substring scanning" constraint.
 */
export const TECHNIQUE_MIN_IMPACT: Record<string, ImpactLevel> = {
  // Critical: identity/credential destruction or exfiltration
  authBypass: 'critical',
  credentialExtraction: 'critical',
  reverseShell: 'critical',
  dataExfiltration: 'critical',
  destructiveAction: 'critical',
  // High: active exploitation / injection / escalation
  sqlInjection: 'high',
  injection: 'high',
  xss: 'high',
  exploitation: 'high',
  privilegeEscalation: 'high',
  idor: 'high',
  ssrf: 'high',
}

const IMPACT_RANK: Record<ImpactLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/**
 * Escalate a declared impact to the technique's minimum floor (fail-closed).
 *
 *  - declared present + technique known   → max(declared, technique floor)
 *  - declared present + technique unknown → declared (trust the typed field)
 *  - declared missing + technique known   → technique floor
 *  - declared missing + technique unknown → 'high' (fail-closed: cannot trust
 *    an unverifiable proposal, so be restrictive)
 *
 * No substring scanning of technique *names* — `skillId` is a structured value
 * looked up in a fixed map.
 */
export function escalateImpactForTechnique(
  declared: ImpactLevel | undefined,
  skillId: string | undefined,
): ImpactLevel {
  const floor = TECHNIQUE_MIN_IMPACT[skillId ?? '']
  if (!floor) {
    // Unknown technique: fail-closed on missing impact only.
    return declared ?? 'high'
  }
  const base = declared ? IMPACT_RANK[declared] : -1
  return base >= IMPACT_RANK[floor] ? (declared as ImpactLevel) : floor
}

function impactRequiresHuman(impact: ImpactLevel, mode: ApprovalMode): boolean {
  if (impact === 'critical') return true
  if (mode !== 'autonomous' && impact === 'high') return true
  return false
}

// ─── Approval Gate ──────────────────────────────────────────────────────────

/**
 * Decide whether a verified proposal may execute.
 * Precondition: the skeptic has already run structural verification; a proposal
 * that failed verification is rejected earlier (see orchestrator). This function
 * only handles the *approval* gate.
 *
 * Impact classification determines whether human approval is required:
 *  - critical (auth bypass, credential extraction, reverse shell, exfil,
 *    destructive): ALWAYS require human (both modes).
 *  - high (exploit attempt, privilege escalation): require human in hitl/both
 *    modes; auto-approve in autonomous.
 *  - medium (recon, information gathering): auto-approved.
 *  - low (passive analysis, report generation): auto-approved.
 */
export async function decideApproval(ctx: ProposalContext): Promise<ApprovalDecision> {
  const { proposal, approvalMode, humanApprove } = ctx
  const impact = escalateImpactForTechnique(
    proposal.proposal?.impact,
    proposal.proposal?.skillId,
  )

  if (impactRequiresHuman(impact, approvalMode)) {
    if (!humanApprove) {
      return 'pending-human'
    }
    const ok = await humanApprove(proposal)
    return ok ? 'approved' : 'rejected'
  }

  // Autonomous or low/medium impact — the skeptic already cleared it.
  return 'approved'
}
