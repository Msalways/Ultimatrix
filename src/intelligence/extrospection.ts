/**
 * Extrospection — verify world state changed after action.
 *
 * After recording a finding:
 *   - Re-fetch endpoint to confirm vulnerability persists
 *   - Check if auth bypass still works with fresh session
 *   - Verify SSRF via OAST callback
 *
 * If state changed → tag finding as volatile.
 * If state unchanged → confidence increases.
 *
 * Adapted from PWN extrospection.md.
 */

export type VerificationResult = 'confirmed' | 'volatile' | 'inconclusive'

export interface ExtrospectionCheck {
  findingId: string
  endpoint: string
  checkType: 'refetch' | 're-auth' | 'callback' | 'replay'
  result: VerificationResult
  details: string
  timestamp: string
}

export class ExtrospectionManager {
  private checks: ExtrospectionCheck[] = []

  /** Record a verification check. */
  record(check: Omit<ExtrospectionCheck, 'timestamp'>): ExtrospectionCheck {
    const entry: ExtrospectionCheck = { ...check, timestamp: new Date().toISOString() }
    this.checks.push(entry)
    return entry
  }

  /** Get all checks for a finding. */
  getByFinding(findingId: string): ExtrospectionCheck[] {
    return this.checks.filter(c => c.findingId === findingId)
  }

  /** Get overall confidence for a finding (ratio of confirmed checks). */
  getConfidence(findingId: string): number {
    const checks = this.getByFinding(findingId)
    if (checks.length === 0) return 0.5 // default confidence
    const confirmed = checks.filter(c => c.result === 'confirmed').length
    return confirmed / checks.length
  }

  /** Check if a finding is volatile (any check returned volatile). */
  isVolatile(findingId: string): boolean {
    return this.getByFinding(findingId).some(c => c.result === 'volatile')
  }

  /** Get all checks. */
  getAll(): ExtrospectionCheck[] {
    return this.checks
  }
}
