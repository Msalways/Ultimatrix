/**
 * Evidence Anti-Hallucination Gate
 *
 * Records all real tool outputs. When the LLM claims a finding,
 * cross-checks: does the claimed evidence actually appear character-for-character
 * in a real tool output? If not → hallucination → reject.
 *
 * This is the #1 reliability improvement for LLM-driven security testing.
 */

import { FLAG_RE } from './constants'

export interface ClaimVerification {
  verified: boolean
  missing: string[]
  flagsInClaim: string[]
  flagsInEvidence: string[]
}

export interface CompletionCheck {
  grounded: boolean
  reason: string
  flagsFound: string[]
}

export class EvidenceGate {
  private evidenceBuffer: string[] = []
  private maxBufferSize = 400
  private unsupportedClaims: string[] = []

  recordToolOutput(output: string): void {
    if (!output) return
    this.evidenceBuffer.push(output)
    if (this.evidenceBuffer.length > this.maxBufferSize) {
      this.evidenceBuffer.splice(0, this.maxBufferSize / 2)
    }
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

  verifyClaim(claim: string): ClaimVerification {
    if (this.evidenceBuffer.length === 0) {
      return {
        verified: false,
        missing: ['No tool output recorded — cannot verify any claim'],
        flagsInClaim: this.extractFlags(claim),
        flagsInEvidence: [],
      }
    }

    const flagsInClaim = this.extractFlags(claim)
    const fullEvidence = this.evidenceBuffer.join('\n')
    const flagsInEvidence = this.extractFlags(fullEvidence)

    // Flag verification: all flags mentioned in claim must appear in evidence
    const missing = flagsInClaim.filter(f => !flagsInEvidence.includes(f))

    // Semantic fact extraction: check if key facts from the claim appear in evidence
    // Instead of substring matching (which fails for natural language vs JSON),
    // extract specific facts (URLs, status codes, header names, finding types)
    // and verify those appear in the evidence.
    const claimFacts = this.extractFacts(claim)
    const evidenceLower = fullEvidence.toLowerCase()
    const missingFacts = claimFacts.filter(f => !evidenceLower.includes(f.toLowerCase()))

    const verified = missing.length === 0 && missingFacts.length === 0
    if (!verified) {
      this.recordUnsupportedClaim(claim.slice(0, 200))
    }

    return {
      verified,
      missing: [...missing, ...missingFacts],
      flagsInClaim,
      flagsInEvidence,
    }
  }

  /**
   * Extract verifiable facts from a claim sentence.
   * Returns lowercase fact strings that should appear in tool output evidence.
   */
  private extractFacts(claim: string): string[] {
    const facts: string[] = []

    // HTTP status codes: "200", "401", "403", "500"
    const statusMatches = claim.match(/\b[1-5]\d{2}\b/g)
    if (statusMatches) facts.push(...statusMatches)

    // URLs: "https://...", "http://..."
    const urlMatches = claim.match(/https?:\/\/[^\s"')]+/g)
    if (urlMatches) facts.push(...urlMatches)

    // HTTP methods: "GET", "POST", "PUT", "DELETE"
    const methodMatches = claim.match(/\b(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/gi)
    if (methodMatches) facts.push(...methodMatches.map(m => m.toUpperCase()))

    // Common HTTP header names
    const headerNames = ['cookie', 'authorization', 'x-csrf-token', 'x-frame-options',
      'content-security-policy', 'set-cookie', 'x-xss-protection', 'strict-transport-security']
    const claimLower = claim.toLowerCase()
    for (const h of headerNames) {
      if (claimLower.includes(h)) facts.push(h)
    }

    // Finding types
    const findingTypes = ['xss', 'sqli', 'sql injection', 'ssrf', 'xxe', 'idor', 'csrf',
      'open redirect', 'ssrf', 'command injection', 'ssti', 'authentication bypass']
    for (const ft of findingTypes) {
      if (claimLower.includes(ft)) facts.push(ft)
    }

    return facts
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
    const goalWantsFlag = ['flag', 'ctf', 'shell', 'getshell', 'rce'].some(k => goalLower.includes(k))

    if (!goalWantsFlag) {
      return { grounded: true, reason: 'Goal does not require flag/shell extraction', flagsFound: [] }
    }

    const fullEvidence = this.evidenceBuffer.join('\n')
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

  getBuffer(): string[] {
    return [...this.evidenceBuffer]
  }

  clear(): void {
    this.evidenceBuffer = []
    this.unsupportedClaims = []
  }

  getBufferSummary(maxChars = 6000): string {
    const joined = this.evidenceBuffer.join('\n')
    if (joined.length <= maxChars) return joined
    return joined.slice(-maxChars)
  }

  private isBoilerplate(sentence: string): boolean {
    const s = sentence.toLowerCase()
    return (
      s.includes('the request') ||
      s.includes('the response') ||
      s.includes('the following') ||
      s.includes('as shown') ||
      s.includes('see above') ||
      s.includes('note that') ||
      s.length < 30
    )
  }
}
