/**
 * Shared approval policy for the Execution Core.
 *
 * T0.5 (Wave Core): re-exports the council approval module so both strategies
 * and the runner share a single approval gate.
 */

export { decideApproval, type ApprovalMode } from '../council/approval'
export type { ApprovalDecision } from '../council/approval'
