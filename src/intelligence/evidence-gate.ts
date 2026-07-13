/**
 * Evidence Anti-Hallucination Gate
 *
 * Records real tool outputs. When the LLM claims a finding, the claim is
 * verified STRUCTURALLY against typed observed facts — never by substring
 * scanning of free-text prose. This is the root-cause fix for hallucinated
 * findings: claims must be backed by a recorded evidence item whose typed
 * `observed` fields (method/url/status) match what the claim asserts.
 *
 * Flag extraction / completion checks (CTF mode) are preserved separately and
 * operate only on the raw text buffer; they do not affect finding verification.
 */

import { FLAG_RE } from './constants'
import {
  verifyFindingClaim,
  type EvidenceItem,
  type FindingClaim,
  type VerificationResult,
} from './evidence-ledger'
import { coreEvidenceLedger } from '../core/evidence'

export type ClaimVerification = VerificationResult

export interface CompletionCheck {
  grounded: boolean
  reason: string
  flagsFound: string[]
}

export class EvidenceGate {
  /** Structured evidence ledger — source of truth for claim verification. */
  private ledger = coreEvidenceLedger
  /** Raw text buffer — only for flag extraction / completion checks (CTF). */
  private textBuffer: string[] = []
  private maxBufferSize = 400
  private unsupportedClaims: string[] = []

  /** Record raw tool output as text (used for flag extraction / completion). */
  recordToolOutput(output: string): void {
    if (!output) return
    this.textBuffer.push(output)
    if (this.textBuffer.length > this.maxBufferSize) {
      this.textBuffer.splice(0, this.maxBufferSize / 2)
    }
  }

  /** Record a structured evidence item (typed observed facts). */
  recordObserved(
    item: Omit<EvidenceItem, 'id' | 'timestamp'> &
      Partial<Pick<EvidenceItem, 'id' | 'timestamp'>>,
  ): EvidenceItem {
    return this.ledger.record(item)
  }

  recordUnsupportedClaim(claim: string): void {
    if (!this.unsupportedClaims.includes(claim)) {
      this.unsupportedClaims.push(claim)
      if (this.unsupportedClaims.length > 20) {
        this.unsupportedClaims.splice(0, 10)
      }
    }
  }

  getUnsupportedClaims(): string[] {
    return [...this.unsupportedClaims]
  }

  /**
   * Structural verification: does a recorded evidence item support every field
   * the claim asserts? No substring scanning of claim prose.
   */
  verifyClaim(claim: FindingClaim): VerificationResult {
    return verifyFindingClaim(claim, this.ledger.all())
  }

  getBuffer(): string[] {
    return [...this.textBuffer]
  }

  getBufferSummary(maxChars = 6000): string {
    const joined = this.textBuffer.join('\n')
    if (joined.length <= maxChars) return joined
    return joined.slice(-maxChars)
  }

  extractFlags(text: string): string[] {
    if (!text) return []
    const matches = text.matchAll(new RegExp(FLAG_RE.source, 'g'))
    const seen = new Set<string>()
    const result: string[] = []
    for (const m of matches) {
      if (!seen.has(m[0])) {
        seen.add(m[0])
        result.push(m[0])
      }
    }
    return result
  }

  verifyCompletion(goal: string): CompletionCheck {
    const goalLower = (goal || '').toLowerCase()
    const goalWantsFlag = ['flag', 'ctf', 'shell', 'getshell', 'rce'].some(k =>
      goalLower.includes(k),
    )

    if (!goalWantsFlag) {
      return { grounded: true, reason: 'Goal does not require flag/shell extraction', flagsFound: [] }
    }

    const fullEvidence = this.textBuffer.join('\n')
    const flagsFound = this.extractFlags(fullEvidence)

    if (flagsFound.length > 0) {
      return { grounded: true, reason: `Flag verified in real tool output: ${flagsFound[0]}`, flagsFound }
    }

    return {
      grounded: false,
      reason: 'Goal requires flag but no flag pattern found in any real tool output',
      flagsFound: [],
    }
  }

  clear(): void {
    this.ledger.clear()
    this.textBuffer = []
    this.unsupportedClaims = []
  }
}
