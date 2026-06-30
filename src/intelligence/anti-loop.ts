/**
 * Anti-Loop / Stale Detection
 *
 * Prevents the LLM from going in circles by tracking:
 * - Rounds since last finding
 * - Per-URL failure count (blocks unreachable targets)
 * - Dead-end signals in LLM output
 * - Whether a step represents real progress or just another failure
 * - Attack path diversity (via explicit agent declaration, NOT keyword guessing)
 *
 * Design principle: the agent DECLARES what it's doing. We record it.
 * We never guess the attack path from free text — that goes stale.
 */

import {
  DEAD_END_MARKERS,
  MEANINGFUL_PROGRESS,
  MEANINGFUL_FAILURES,
  FAILED_ACCESS_PATTERNS,
  ATTACK_PATHS,
  type AttackPath,
} from './constants'

// ── Structured tag extraction ──────────────────────────────────────────────

const PATH_TAG_RE = /\[PATH:\s*([a-z_]+)\]/i

/**
 * Extract attack path tag from LLM output.
 * The agent is instructed to include `[PATH: sqli]` when switching attack types.
 * Returns null if no tag found — callers should use Blackboard intent as fallback.
 */
export function extractAttackPath(llmOutput: string): AttackPath | null {
  if (!llmOutput) return null
  const match = llmOutput.match(PATH_TAG_RE)
  if (!match) return null
  const tag = match[1].toLowerCase()
  return ATTACK_PATHS.includes(tag as AttackPath) ? tag as AttackPath : null
}

// ── Loop detector ──────────────────────────────────────────────────────────

export class LoopDetector {
  roundsSinceLastFindings = 0
  failedTargets = new Map<string, number>()
  blockedTargets = new Set<string>()
  private attackPathHistory: AttackPath[] = []

  recordRound(hasNewFinding: boolean): void {
    if (hasNewFinding) {
      this.roundsSinceLastFindings = 0
    } else {
      this.roundsSinceLastFindings++
    }
  }

  isStale(threshold: number): boolean {
    return this.roundsSinceLastFindings >= threshold
  }

  trackFailedTarget(url: string, error: string): string | null {
    const hostname = extractHostname(url)
    if (!hostname) return null

    const isFailedAccess = FAILED_ACCESS_PATTERNS.some(p => error.includes(p))
    if (!isFailedAccess) return null

    const count = (this.failedTargets.get(hostname) || 0) + 1
    this.failedTargets.set(hostname, count)

    if (count >= 3) {
      this.blockedTargets.add(hostname)
      return hostname
    }
    return null
  }

  isTargetBlocked(hostname: string): boolean {
    return this.blockedTargets.has(hostname)
  }

  recordAttackPath(path: AttackPath): void {
    if (path && !this.attackPathHistory.includes(path)) {
      this.attackPathHistory.push(path)
    }
  }

  getAttackPathHistory(): AttackPath[] {
    return [...this.attackPathHistory]
  }

  reset(): void {
    this.roundsSinceLastFindings = 0
    this.failedTargets.clear()
    this.blockedTargets.clear()
    this.attackPathHistory = []
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function extractHostname(url: string): string | null {
  try {
    if (url.startsWith('http')) {
      return new URL(url).hostname
    }
    const match = url.match(/^([a-zA-Z0-9.-]+)(?::\d+)?(?:\/.*)?$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export function detectDeadEnd(llmOutput: string): boolean {
  if (!llmOutput) return false
  const lower = llmOutput.toLowerCase()
  return DEAD_END_MARKERS.some(m => lower.includes(m))
}

export function isMeaningfulStep(step: string): boolean {
  if (!step) return false
  const lower = step.toLowerCase()

  if (MEANINGFUL_FAILURES.some(f => step.includes(f))) return false
  if (MEANINGFUL_PROGRESS.some(p => lower.includes(p))) return true

  return true
}
