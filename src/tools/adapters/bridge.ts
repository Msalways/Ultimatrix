/**
 * Evidence-gate bridge for external-tool results.
 *
 * An external scanner (nuclei/sqlmap/...) may report many findings. Per the
 * user-chosen trust boundary, NONE become Findings until Ultimatrix
 * independently re-verifies them. `bridgeToolResult` walks each finding and,
 * for those that locate a URL, issues a confirming request recorded into the
 * structured evidence ledger, then runs `verifyClaimStructured`.
 *
 * Confirmed findings carry their evidence id so the brain can subsequently call
 * `writeFinding` (which itself re-checks the same ledger) with a grounded claim.
 * Unconfirmed findings are returned as `candidates` for `recordFindingCandidate`.
 */

import type {BridgeReport, ToolAdapter, ToolResult} from './types'
import { verifyFinding } from './common'

export async function bridgeToolResult(
  _adapter: ToolAdapter,
  result: ToolResult,
): Promise<BridgeReport> {
  const report: BridgeReport = { confirmed: [], candidates: [], evidenceIds: [], skipped: [] }

  for (const finding of result.findings) {
    const { report: slice } = await verifyFinding(finding)
    report.confirmed.push(...slice.confirmed)
    report.candidates.push(...slice.candidates)
    report.skipped.push(...slice.skipped)
    report.evidenceIds.push(...slice.evidenceIds)
  }

  return report
}
