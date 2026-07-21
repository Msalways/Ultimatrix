/**
 * External-tool adapter contracts.
 *
 * Ultimatrix orchestrates real best-of-breed hacker binaries (nuclei, sqlmap,
 * ffuf, nmap, jwt_tool, arjun, corsy, subfinder, gitleaks) behind one uniform
 * `ToolAdapter` interface. We do NOT re-implement scanners from scratch — we
 * shell out to the platform-native binary and normalize its output into typed
 * `AdapterFinding`s.
 *
 * Trust boundary (user-chosen): an external tool's reported finding is NEVER
 * written as a Finding until Ultimatrix independently re-verifies it via
 * `bridgeToolResult` (see bridge.ts), which records a confirming request into
 * the structured evidence ledger and runs it through `verifyClaimStructured`.
 *
 * No substring/vocabulary detection anywhere in routing — the brain decides
 * which adapter to call; adapters only normalize their own tool's stdout.
 */

import type { VerificationResult } from '../intelligence/evidence-ledger'

export type AdapterSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** A single normalized finding extracted from a tool's output. */
export interface AdapterFinding {
  /** The in-scope URL the finding pertains to, when the tool reports one. */
  url?: string
  severity?: AdapterSeverity
  /** Human-readable description of what the tool reported. */
  detail: string
  /** Raw line/record the finding was derived from (for audit). */
  raw: string
}

export type ToolRunStatus = 'success' | 'error' | 'timeout' | 'skip'

export interface ToolResult {
  tool: string
  target: string
  status: ToolRunStatus
  output: string
  findings: AdapterFinding[]
  duration: number
  rawOutput?: string
}

export interface AdapterOpts {
  target: string
  options?: Record<string, unknown>
}

/** Outcome of re-verifying an external tool's findings against real evidence. */
export interface BridgeReport {
  /** Findings Ultimatrix independently confirmed (endpoint reachable + recorded). */
  confirmed: AdapterFinding[]
  /** Findings the external tool claimed but Ultimatrix could not reproduce. */
  candidates: AdapterFinding[]
  /** Evidence-item ids created during confirmation (in coreEvidenceLedger). */
  evidenceIds: string[]
  /** Finding details that were skipped (e.g. out-of-scope URL). */
  skipped: AdapterFinding[]
}

export interface ToolAdapter {
  /** Stable tool id used for the Mastra tool + skill toolRefs. */
  id: string
  /** Human description of WHAT the binary does (not an enumeration of vocab). */
  description: string
  /** True when the binary is installed and on PATH. */
  isAvailable(): Promise<boolean>
  /** Execute the binary against the target; returns typed ToolResult. */
  run(opts: AdapterOpts): Promise<ToolResult>
}

export type { VerificationResult }
