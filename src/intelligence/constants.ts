/**
 * Intelligence Layer — Shared Constants
 *
 * All domain-specific data is derived from the TechniqueRegistry
 * (which loads from skill YAML + registry.json). This file provides
 * backward-compatible exports for consumers that import from constants.ts.
 */

import { getTechniqueRegistry } from '../skills/technique-registry'

// ── Canonical attack paths (derived from skills + config) ──────────────────

let _attackPaths: string[] | null = null
export function getAttackPaths(): string[] {
  if (!_attackPaths) _attackPaths = getTechniqueRegistry().getAttackPaths()
  return _attackPaths
}

// Lazy getter that initializes on first access
let _attackPathsInit = false
export const ATTACK_PATHS: string[] = []
function ensureAttackPaths() {
  if (!_attackPathsInit) {
    const paths = getAttackPaths()
    ATTACK_PATHS.length = 0
    ATTACK_PATHS.push(...paths)
    _attackPathsInit = true
  }
}
// Initialize on module load
ensureAttackPaths()

export type AttackPath = string

// ── Access failure patterns (derived from config) ─────────────────────────

let _failedAccessPatterns: string[] | null = null
export function getFailedAccessPatterns(): string[] {
  if (!_failedAccessPatterns) _failedAccessPatterns = getTechniqueRegistry().getFailedAccessPatterns()
  return _failedAccessPatterns
}

let _failedAccessInit = false
export const FAILED_ACCESS_PATTERNS: string[] = []
function ensureFailedAccess() {
  if (!_failedAccessInit) {
    const p = getFailedAccessPatterns()
    FAILED_ACCESS_PATTERNS.length = 0
    FAILED_ACCESS_PATTERNS.push(...p)
    _failedAccessInit = true
  }
}
ensureFailedAccess()

// ── Anti-loop operational signals (derived from config) ───────────────────

export function getDeadEndMarkers(): string[] {
  return getTechniqueRegistry().getDeadEndMarkers()
}

export function getMeaningfulProgress(): string[] {
  return getTechniqueRegistry().getMeaningfulProgress()
}

export function getMeaningfulFailures(): string[] {
  return getTechniqueRegistry().getMeaningfulFailures()
}

let _deadEndInit = false
export const DEAD_END_MARKERS: string[] = []
function ensureDeadEnd() {
  if (!_deadEndInit) {
    DEAD_END_MARKERS.length = 0
    DEAD_END_MARKERS.push(...getDeadEndMarkers())
    _deadEndInit = true
  }
}
ensureDeadEnd()

let _progressInit = false
export const MEANINGFUL_PROGRESS: string[] = []
function ensureProgress() {
  if (!_progressInit) {
    MEANINGFUL_PROGRESS.length = 0
    MEANINGFUL_PROGRESS.push(...getMeaningfulProgress())
    _progressInit = true
  }
}
ensureProgress()

let _failuresInit = false
export const MEANINGFUL_FAILURES: string[] = []
function ensureFailures() {
  if (!_failuresInit) {
    MEANINGFUL_FAILURES.length = 0
    MEANINGFUL_FAILURES.push(...getMeaningfulFailures())
    _failuresInit = true
  }
}
ensureFailures()

// ── Evidence gate ─────────────────────────────────────────────────────────

export const FLAG_RE = /[A-Za-z_][A-Za-z0-9_]{1,20}\{[^{}\n]{1,200}\}/g

// ── Reflexion escalation hints (derived from config) ─────────────────────

export function getEscalationHints(level: number): string[] {
  return getTechniqueRegistry().getEscalationHints(level)
}

let _escalationInit = false
export const ESCALATION_HINTS: Record<number, string[]> = {}
function ensureEscalation() {
  if (!_escalationInit) {
    const reg = getTechniqueRegistry()
    for (let i = 0; i <= 4; i++) {
      ESCALATION_HINTS[i] = reg.getEscalationHints(i)
    }
    _escalationInit = true
  }
}
ensureEscalation()
