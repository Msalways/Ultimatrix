/**
 * Structured Evidence Ledger — root-cause fix for EvidenceGate hallucination.
 *
 * Root cause (verified in code review): `writeFinding` never verified claims
 * against the structured evidence captured by `recordEvidence`. Instead it called
 * `EvidenceGate.verifyClaim`, whose text buffer is never populated in real runs
 * (nothing in src/ calls `recordToolOutput`), so every finding was silently
 * downgraded and the structured evidence was ignored. Verification could only
 * fall back to substring scanning of free text.
 *
 * Fix: introduce typed `ObservedFacts` + `EvidenceItem` + `FindingClaim` and a
 * STRUCTURAL matcher (`verifyFindingClaim`). No free-text substring scanning of
 * claim text — claims are matched field-to-field against recorded evidence.
 *
 * This module is the single source of truth for claim verification. The council
 * `skeptic` and `writeFinding` both use it. `EvidenceGate` delegates to it.
 */

export type EvidenceItemType =
  | 'text'
  | 'screenshot'
  | 'har_entry'
  | 'raw_request'
  | 'raw_response'

/** Typed facts about what actually happened during a tool execution. */
export interface ObservedFacts {
  method?: string
  url?: string
  status?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  responseTimeMs?: number
}

/** Body signature assertion for independent gate verification. */
export interface BodySignature {
  type: 'contains' | 'regex' | 'timing' | 'not-contains' | 'status-differs'
  pattern: string
  threshold?: number
}

/** A single structured evidence record captured by a tool. */
export interface EvidenceItem {
  id: string
  type: EvidenceItemType
  data: string
  label: string
  timestamp: number
  session?: string
  observed?: ObservedFacts
}

/** A finding claim made by the LLM, carrying typed observed facts (not prose). */
export interface FindingClaim {
  type: string
  endpoint: string
  param?: string
  method?: string
  observed?: ObservedFacts & { bodySignature?: BodySignature }
}

export interface VerificationResult {
  verified: boolean
  /** Which asserted fields lacked any supporting evidence item. */
  missing: string[]
  /** Ids of evidence items that structurally support the full claim. */
  supporting: string[]
}

function normalizeUrl(input?: string): string | undefined {
  if (!input) return undefined
  const s = input.trim()
  if (!s) return undefined
  try {
    const u = new URL(s)
    const path = u.pathname.replace(/\/+$/, '').toLowerCase()
    return (u.origin + path + u.search).toLowerCase()
  } catch {
    // Not an absolute URL (e.g. a path). Lowercase + strip trailing slash.
    return s.toLowerCase().replace(/\/+$/, '')
  }
}

function urlMatches(claimEndpoint: string, itemUrl?: string): boolean {
  const cn = normalizeUrl(claimEndpoint)
  const itemNorm = normalizeUrl(itemUrl)
  if (!cn || !itemNorm) return false
  return cn === itemNorm || cn.includes(itemNorm) || itemNorm.includes(cn)
}

/**
 * Structural verification: a claim is supported when at least one evidence item
 * records observed facts consistent with every field the claim asserts.
 *
 * - endpoint is matched by item.observed.url (normalized).
 * - method/status are only checked when the claim asserts them; the supporting
 *   item must record the same value (co-occurrence on a single item).
 *
 * No substring scanning of claim prose. The only containment is URL-based
 * (host/path), which is a structured locator comparison, not free-text matching.
 */
function checkBodySignature(sig: BodySignature, item: EvidenceItem): boolean {
  const body = item.data ?? ''
  const time = item.observed?.responseTimeMs
  const status = item.observed?.status
  switch (sig.type) {
    case 'contains':
      return body.toLowerCase().includes(sig.pattern.toLowerCase())
    case 'not-contains':
      return !body.toLowerCase().includes(sig.pattern.toLowerCase())
    case 'regex':
      try { return new RegExp(sig.pattern, 'i').test(body) } catch { return false }
    case 'timing':
      return time != null && sig.threshold != null && time >= sig.threshold
    case 'status-differs':
      return status != null && sig.threshold != null && status !== sig.threshold
    default:
      return false
  }
}

export function verifyFindingClaim(
  claim: FindingClaim,
  items: EvidenceItem[],
): VerificationResult {
  const needMethod = claim.method?.toLowerCase()
  const needStatus = claim.observed?.status
  const needBodySig = (claim.observed as any)?.bodySignature as BodySignature | undefined

  let endpointFound = false
  let methodFound = false
  let statusFound = false
  let bodySigFound = false
  const supporting: string[] = []

  for (const item of items) {
    const obs = item.observed
    const epMatch = urlMatches(claim.endpoint, obs?.url)
    if (epMatch) endpointFound = true

    const methodMatch =
      !!needMethod && !!obs?.method && obs.method.toLowerCase() === needMethod
    if (methodMatch) methodFound = true

    const statusMatch =
      needStatus != null && obs?.status != null && obs.status === needStatus
    if (statusMatch) statusFound = true

    let bodySigMatch = true
    if (needBodySig) {
      bodySigMatch = checkBodySignature(needBodySig, item)
      if (bodySigMatch) bodySigFound = true
    }

    const fullySupports =
      epMatch &&
      (needMethod == null || obs?.method?.toLowerCase() === needMethod) &&
      (needStatus == null || obs?.status === needStatus) &&
      (!needBodySig || bodySigMatch)

    if (fullySupports) supporting.push(item.id)
  }

  const missing: string[] = []
  if (!endpointFound) missing.push(`endpoint:${claim.endpoint}`)
  if (needMethod && !methodFound) missing.push(`method:${claim.method}`)
  if (needStatus != null && !statusFound) missing.push(`status:${needStatus}`)
  if (needBodySig && !bodySigFound) missing.push(`bodySignature:${needBodySig.type}:${needBodySig.pattern}`)

  return {
    verified: missing.length === 0,
    missing,
    supporting,
  }
}

/**
 * Session/council-scoped ledger. Tools push structured `EvidenceItem`s; the
 * skeptic/council verifies claims against them. Pure in-memory.
 */
export class EvidenceLedger {
  private items: EvidenceItem[] = []
  private seq = 0

  record(
    item: Omit<EvidenceItem, 'id' | 'timestamp'> &
      Partial<Pick<EvidenceItem, 'id' | 'timestamp'>>,
  ): EvidenceItem {
    const recorded: EvidenceItem = {
      id: item.id ?? `ev_${Date.now()}_${++this.seq}`,
      timestamp: item.timestamp ?? Date.now(),
      type: item.type,
      data: item.data,
      label: item.label,
      ...(item.session ? { session: item.session } : {}),
      ...(item.observed ? { observed: item.observed } : {}),
    }
    this.items.push(recorded)
    return recorded
  }

  get(id: string): EvidenceItem | undefined {
    return this.items.find(i => i.id === id)
  }

  all(): EvidenceItem[] {
    return [...this.items]
  }

  /** Verify a claim against every recorded item. */
  verify(claim: FindingClaim): VerificationResult {
    return verifyFindingClaim(claim, this.items)
  }

  clear(): void {
    this.items = []
    this.seq = 0
  }
}
