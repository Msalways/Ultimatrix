/**
 * Proof Rules — deterministic minimum evidence floors for finding creation and
 * reporting (Slice 09).
 *
 * A finding "passes proof" only when the evidence attached to it (or recorded
 * in the global ledger for the same endpoint) meets a typed floor for its
 * severity, and no contradictory evidence exists. Everything is typed and
 * structural — no prose scanning.
 *
 * Floors by severity (impact):
 *   critical — ≥2 independent captures of kind har_entry/raw_request/raw_response
 *   high     — ≥1 non-text capture (screenshot/har_entry/raw_request/raw_response)
 *   medium   — ≥1 evidence item of any kind
 *   low      — ≥1 evidence item of any kind, conflicts tolerated
 *   info     — no floor (informational note, not a vuln claim)
 *
 * Findings fail CLOSED: any missing/conflicting evidence blocks promotion.
 * Findings with a passing proof carry a typed `ProofCheckResult` so report
 * generators can exclude failed findings and show the check metadata.
 */

import type { EvidenceItem, EvidenceItemType } from './evidence-ledger'
import { urlMatchesEndpoint } from './evidence-ledger'

export interface ProofRule {
  id: string
  /** Finding class this rule applies to ('*' = all classes via severity floor). */
  findingType: string
  /** Evidence kinds that count toward the floor. Empty = no floor. */
  requiredEvidenceKinds: EvidenceItemType[]
  /** Minimum number of independent qualifying evidence items required. */
  minIndependentSources: number
  /** Whether contradictory evidence is tolerated for this rule. */
  allowConflicts: boolean
}

export interface ProofCheckResult {
  ruleId: string
  findingId?: string
  passed: boolean
  missingEvidence: string[]
  conflicts: string[]
  evidenceRefs: string[]
}

export interface ProofCheckInput {
  findingType: string
  endpoint: string
  severity: string
  /** Status the claim asserts was observed — basis for conflict detection. */
  observedStatus?: number
  findingId?: string
  /** Explicit rule (finding-class override). Defaults to severity floor. */
  rule?: ProofRule
  /** Every evidence item considered for this finding (attached + ledger). */
  items: EvidenceItem[]
}

const STRUCTURED_KINDS: EvidenceItemType[] = ['har_entry', 'raw_request', 'raw_response']
const NON_TEXT_KINDS: EvidenceItemType[] = ['screenshot', 'har_entry', 'raw_request', 'raw_response']
const ALL_KINDS: EvidenceItemType[] = ['text', 'screenshot', 'har_entry', 'raw_request', 'raw_response']

/** Default deterministic floor for a severity. Unknown severities get no floor. */
export function defaultProofFloor(severity: string): ProofRule {
  switch (severity) {
    case 'critical':
      return { id: 'floor-critical', findingType: '*', requiredEvidenceKinds: STRUCTURED_KINDS, minIndependentSources: 2, allowConflicts: false }
    case 'high':
      return { id: 'floor-high', findingType: '*', requiredEvidenceKinds: NON_TEXT_KINDS, minIndependentSources: 1, allowConflicts: false }
    case 'medium':
      return { id: 'floor-medium', findingType: '*', requiredEvidenceKinds: ALL_KINDS, minIndependentSources: 1, allowConflicts: false }
    case 'low':
      return { id: 'floor-low', findingType: '*', requiredEvidenceKinds: ALL_KINDS, minIndependentSources: 1, allowConflicts: true }
    default:
      return { id: 'floor-info', findingType: '*', requiredEvidenceKinds: [], minIndependentSources: 0, allowConflicts: true }
  }
}

/** Per-finding-class rule overrides, keyed by finding class. */
const customRules = new Map<string, ProofRule>()

/** Register a finding-class-specific proof rule (overrides the severity floor). */
export function registerProofRule(rule: ProofRule): void {
  customRules.set(rule.findingType, rule)
}

export function clearProofRules(): void {
  customRules.clear()
}

export function resolveProofRule(findingType: string, severity: string): ProofRule {
  return customRules.get(findingType) ?? defaultProofFloor(severity)
}

/**
 * Deterministic conflict detection: when the claim asserts a status was
 * observed, any endpoint-matching evidence item recording a DIFFERENT status
 * contradicts the claim. Differential (baseline vs mutated) evidence is NOT a
 * conflict unless the claim pins one status — only the asserted status is the
 * reference point.
 */
export function findProofConflicts(endpoint: string, observedStatus: number | undefined, items: EvidenceItem[]): string[] {
  if (observedStatus == null) return []
  const conflicts: string[] = []
  for (const item of items) {
    const st = item.observed?.status
    if (st == null) continue
    if (!urlMatchesEndpoint(endpoint, item.observed?.url)) continue
    if (st !== observedStatus) {
      conflicts.push(`status:${st} contradicts asserted status:${observedStatus} (evidence ${item.id})`)
    }
  }
  return conflicts
}

/**
 * Does an evidence item count toward a finding's proof floor? Items carrying an
 * explicit URL must match the finding's endpoint (unrelated evidence never
 * counts). Items without a URL are treated as attached-to-this-finding.
 */
function qualifiesForEndpoint(endpoint: string, item: EvidenceItem): boolean {
  const url = item.observed?.url
  if (url == null) return true
  return urlMatchesEndpoint(endpoint, url)
}

/** Run the proof check: floor + conflicts. Fails CLOSED on missing evidence. */
export function checkProof(input: ProofCheckInput): ProofCheckResult {
  const rule = input.rule ?? resolveProofRule(input.findingType, input.severity)

  if (rule.minIndependentSources === 0 && rule.requiredEvidenceKinds.length === 0) {
    return { ruleId: rule.id, findingId: input.findingId, passed: true, missingEvidence: [], conflicts: [], evidenceRefs: [] }
  }

  const qualifying = input.items.filter(i => rule.requiredEvidenceKinds.includes(i.type) && qualifiesForEndpoint(input.endpoint, i))
  const sources = new Set(qualifying.map(i => i.id))
  const evidenceRefs = [...sources]

  const missingEvidence: string[] = []
  if (evidenceRefs.length < rule.minIndependentSources) {
    missingEvidence.push(
      `need >= ${rule.minIndependentSources} independent evidence item(s) of kind ${rule.requiredEvidenceKinds.join('/')}, have ${evidenceRefs.length}`,
    )
  }

  const conflicts = rule.allowConflicts ? [] : findProofConflicts(input.endpoint, input.observedStatus, input.items)

  return {
    ruleId: rule.id,
    findingId: input.findingId,
    passed: missingEvidence.length === 0 && conflicts.length === 0,
    missingEvidence,
    conflicts,
    evidenceRefs,
  }
}

/** Merge attached + ledger evidence for a finding, deduped by id. */
export function combineFindingEvidence(endpoint: string, attached: EvidenceItem[], ledger: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>()
  const combined: EvidenceItem[] = []
  for (const item of [...attached, ...ledger]) {
    if (!urlMatchesEndpoint(endpoint, item.observed?.url)) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    combined.push(item)
  }
  return combined
}
