/**
 * Shared structured-evidence ledger for the entire Execution Core.
 *
 * Root-cause fix (T0.2, Wave Core): prior to this there were THREE separate
 * `EvidenceLedger` instances that never agreed with each other —
 *   1. `control-tools.structuredLedger`  (tool-captured evidence)
 *   2. `EvidenceGate.ledger`             (per-instance, never saw #1)
 *   3. council skeptic via `verifyClaimStructured` (== #1, module singleton)
 *
 * Tools recorded evidence into #1, but the `EvidenceGate` used #2 and so its
 * `verifyClaim` looked at an EMPTY ledger — the exact divergence that let
 * findings be verified against nothing. This module makes every participant
 * record and verify against ONE instance.
 *
 * `EvidenceGate` keeps its own raw text buffer (CTF flag extraction) but uses
 * this shared ledger for structural claim verification. `control-tools`
 * re-uses the same instance. Council skeptic / `writeFinding` already route
 * through `control-tools`, so they are unified automatically.
 */

import { EvidenceLedger } from '../intelligence/evidence-ledger'

export const coreEvidenceLedger = new EvidenceLedger()

export { EvidenceLedger }
