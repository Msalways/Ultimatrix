/**
 * Case Sanitizer (Phase 4).
 *
 * Strips sensitive values from ResearchCases before promoting to
 * reusable global memory. Removes URLs, hostnames, cookies, headers,
 * tokens, payloads. Keeps framework patterns, reasoning mistakes,
 * kill signals, and counter-evidence patterns.
 */

import type { ResearchCase } from './types'

/** Patterns that indicate sensitive content */
const SENSITIVE_PATTERNS = [
  /https?:\/\/[^\s]+/gi,                    // URLs
  /[a-zA-Z0-9.-]+\.(com|org|net|io|dev)/gi, // Hostnames
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/,  // JWT tokens
  /Bearer\s+[A-Za-z0-9._-]+/gi,             // Bearer tokens
  /Cookie:\s*[^\n]+/gi,                      // Cookie headers
  /Authorization:\s*[^\n]+/gi,              // Auth headers
  /(?:password|secret|key|token)\s*[:=]\s*[^\s]+/gi, // Secrets
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // IP addresses
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, // UUIDs
]

/** Strings that are always sensitive (exact matches) */
const SENSITIVE_EXACT = new Set([
  'password',
  'secret',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'session_id',
])

/**
 * Sanitize a ResearchCase for reusable memory.
 * Returns a new case with sensitive values removed.
 */
export function sanitizeForMemory(caseData: ResearchCase): ResearchCase {
  return {
    ...caseData,
    initialHypothesis: sanitizeText(caseData.initialHypothesis),
    contextFeatures: caseData.contextFeatures.map(sanitizeText),
    decisiveEvidence: caseData.decisiveEvidence.map(sanitizeText),
    counterEvidence: caseData.counterEvidence.map(sanitizeText),
    falsePositiveReason: caseData.falsePositiveReason
      ? sanitizeText(caseData.falsePositiveReason)
      : undefined,
    killSignal: caseData.killSignal
      ? sanitizeText(caseData.killSignal)
      : undefined,
    reusableLesson: caseData.reusableLesson
      ? sanitizeText(caseData.reusableLesson)
      : undefined,
    // sourceRefs are reference IDs, not raw data — safe to keep
    sourceRefs: [],
  }
}

/**
 * Check if text contains sensitive values.
 */
export function containsSensitiveValues(text: string): boolean {
  const lower = text.toLowerCase()

  // Check exact matches
  for (const sensitive of SENSITIVE_EXACT) {
    if (lower.includes(sensitive)) return true
  }

  // Check regex patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) return true
  }

  return false
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeText(text: string): string {
  let result = text

  // Replace sensitive patterns with placeholders
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }

  // Clean up multiple redactions
  result = result.replace(/\[REDACTED\](\s*\[REDACTED\])+/g, '[REDACTED]')

  return result
}
