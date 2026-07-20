/**
 * Canonical shared types for the Ultimatrix codebase.
 * All duplicated type literals are defined here once and imported everywhere.
 */

// ─── Severity / Risk Levels ────────────────────────────────────────

/** Full 5-level severity used for findings, candidates, hypotheses */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** Reduced 3-level severity for chain rules (no low/info) */
export type ChainSeverity = 'critical' | 'high' | 'medium'

/** Reduced 3-level severity for regressions (no critical/info) */
export type RegressionSeverity = 'high' | 'medium' | 'low'

/** Alias — research module uses this name */
export type RiskLevel = Severity

// ─── Evidence & Lifecycle Statuses ─────────────────────────────────

export type EvidenceLevel = 'L1' | 'L2' | 'L3' | 'L4'

export type FindingLifecycleStatus =
  | 'candidate'
  | 'pending_verification'
  | 'verified'
  | 'rejected'
  | 'disproven'
  | 'needs_review'

// ─── Research Statuses ─────────────────────────────────────────────

export type HypothesisStatus =
  | 'open'
  | 'planned'
  | 'testing'
  | 'candidate'
  | 'verified'
  | 'rejected'

export type ExperimentStatus =
  | 'planned'
  | 'running'
  | 'interesting'
  | 'rejected'
  | 'blocked'

export type CandidateFindingStatus =
  | 'candidate'
  | 'needs-more-evidence'
  | 'verified'
  | 'rejected'

// ─── Auth Flow ─────────────────────────────────────────────────────

export type AuthFlowType = 'login' | 'logout' | 'refresh' | 'jwt-forgery' | 'default-creds' | 'oauth' | 'session-reuse'

// ─── HTTP Methods (for request/replay types) ──────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

// ─── Chain Rules ───────────────────────────────────────────────────

export interface ChainRule {
  name: string
  source: string
  target: string
  description: string
  severity: ChainSeverity
}
