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

import type { ApprovalMode, CouncilMemberRole, ImpactLevel, MemberOutput } from './types'
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
  const impact = classifyImpact(proposal)

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
