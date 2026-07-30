/**
 * Debate Memory — tracks member stances across debate turns.
 *
 * Design principle: structured types, not text parsing.
 * Stances are extracted from typed MemberOutput fields, not from free text.
 *
 * The debate memory accumulates across REPL turns so members:
 * 1. Maintain consistency — don't contradict themselves
 * 2. Reference each other's arguments — "as the skeptic said..."
 * 3. Avoid failed approaches — "we tried SQLi on /api/users and got 403"
 * 4. Track proven findings — "XSS on /search is confirmed"
 */

import type {CouncilMemberRole, MemberOutput, CouncilCritique} from './types'

// ─── Types ──────────────────────────────────────────────────────────────────

export type StancePosition = 'for' | 'against' | 'alternative'

export interface Stance {
  /** Who took this position. */
  member: CouncilMemberRole
  /** Which debate round this was from. */
  round: number
  /** Position on the proposal. */
  position: StancePosition
  /** What the stance is about (proposal action or critique target). */
  target: string
  /** Why this position was taken. */
  reasoning: string
}

export interface FailedApproach {
  /** Which round this was attempted. */
  round: number
  /** What technique was tried. */
  technique: string
  /** Which endpoint was targeted. */
  endpoint: string
  /** Why it failed. */
  reason: string
}

export interface ProvenFinding {
  /** Which round this was confirmed. */
  round: number
  /** What was found. */
  finding: string
  /** Evidence supporting the finding. */
  evidence: string
}

export interface DebateMemory {
  /** All member stances across rounds. */
  stances: Stance[]
  /** Failed approaches that should not be retried. */
  failedApproaches: FailedApproach[]
  /** Confirmed findings. */
  provenFindings: ProvenFinding[]
}

/** Create an empty debate memory. */
export function createDebateMemory(): DebateMemory {
  return { stances: [], failedApproaches: [], provenFindings: [] }
}

const DEBATE_MEMORY_MARKER = 'DEBATE_MEMORY::'

/**
 * Serialize a DebateMemory to a string for storage in a graph node.
 * Wrapped with a marker so legacy plain-text summaries aren't misread as memory.
 */
export function serializeDebateMemory(memory: DebateMemory): string {
  return DEBATE_MEMORY_MARKER + JSON.stringify(memory)
}

/**
 * Restore a DebateMemory from a stored summary string.
 * Returns null if the string isn't a serialized memory (e.g. a legacy summary).
 */
export function deserializeDebateMemory(summary: string | undefined): DebateMemory | null {
  if (!summary || !summary.startsWith(DEBATE_MEMORY_MARKER)) return null
  try {
    const parsed = JSON.parse(summary.slice(DEBATE_MEMORY_MARKER.length)) as DebateMemory
    if (!parsed || !Array.isArray(parsed.stances)) return null
    return {
      stances: parsed.stances ?? [],
      failedApproaches: parsed.failedApproaches ?? [],
      provenFindings: parsed.provenFindings ?? [],
    }
  } catch {
    return null
  }
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract stances from a member's structured output.
 * Reads typed fields — no text parsing.
 */
export function extractStances(
  output: MemberOutput,
  role: CouncilMemberRole,
  round: number,
): Stance[] {
  const stances: Stance[] = []

  if (output.intent === 'propose' && output.proposal) {
    stances.push({
      member: role,
      round,
      position: 'for',
      target: output.proposal.action,
      reasoning: output.proposal.reasoning,
    })
  }

  if (output.intent === 'critique' && output.critique) {
    const critique = output.critique as CouncilCritique
    for (const disagreement of critique.disagreements) {
      stances.push({
        member: role,
        round,
        position: 'against',
        target: disagreement,
        reasoning: disagreement,
      })
    }
    if (critique.alternative) {
      stances.push({
        member: role,
        round,
        position: 'alternative',
        target: critique.alternative,
        reasoning: critique.alternative,
      })
    }
  }

  return stances
}

/**
 * Extract failed approaches from execution results.
 * Reads structured reflection fields — no text parsing.
 */
export function extractFailedApproaches(
  output: MemberOutput,
  round: number,
): FailedApproach[] {
  const failed: FailedApproach[] = []

  if (output.reflection?.whatFailed) {
    for (const fail of output.reflection.whatFailed) {
      failed.push({
        round,
        technique: fail,
        endpoint: output.proposal?.endpointId ?? '',
        reason: fail,
      })
    }
  }

  return failed
}

/**
 * Extract proven findings from execution results.
 */
export function extractProvenFindings(
  output: MemberOutput,
  round: number,
): ProvenFinding[] {
  const findings: ProvenFinding[] = []

  if (output.reflection?.whatWorked) {
    for (const work of output.reflection.whatWorked) {
      findings.push({
        round,
        finding: work,
        evidence: output.proposal?.action ?? '',
      })
    }
  }

  return findings
}

// ─── Injection ──────────────────────────────────────────────────────────────

/**
 * Build a memory prompt section for a specific member.
 * Shows their past positions, failed approaches, and contradictions.
 */
export function buildMemoryPrompt(memory: DebateMemory, role: CouncilMemberRole): string {
  if (memory.stances.length === 0 && memory.failedApproaches.length === 0 && memory.provenFindings.length === 0) {
    return '' // No history yet
  }

  const parts: string[] = []

  // Show this member's past positions
  const myStances = memory.stances.filter(s => s.member === role)
  if (myStances.length > 0) {
    parts.push('## Your Past Positions')
    for (const stance of myStances.slice(-10)) { // Last 10 to stay within token budget
      const icon = stance.position === 'for' ? '[for]' : stance.position === 'against' ? '[against]' : '[alternative]'
      parts.push(`- Round ${stance.round}: ${icon} ${stance.target}`)
    }
  }

  // Show other members' stances this member should reference
  const otherStances = memory.stances.filter(s => s.member !== role)
  if (otherStances.length > 0) {
    parts.push('')
    parts.push('## Other Members\' Positions')
    for (const stance of otherStances.slice(-10)) {
      const icon = stance.position === 'for' ? '[for]' : stance.position === 'against' ? '[against]' : '[alternative]'
      parts.push(`- ${stance.member} (R${stance.round}): ${icon} ${stance.target}`)
    }
  }

  // Show failed approaches
  if (memory.failedApproaches.length > 0) {
    parts.push('')
    parts.push('## Failed Approaches (DO NOT repeat)')
    for (const fail of memory.failedApproaches.slice(-5)) {
      parts.push(`- Round ${fail.round}: ${fail.technique} — ${fail.reason}`)
    }
  }

  // Show proven findings
  if (memory.provenFindings.length > 0) {
    parts.push('')
    parts.push('## Proven Findings')
    for (const finding of memory.provenFindings.slice(-5)) {
      parts.push(`- Round ${finding.round}: ${finding.finding}`)
    }
  }

  // Consistency instruction
  parts.push('')
  parts.push('Maintain consistency. If you change your mind, explain why with new evidence.')

  return parts.join('\n')
}

// ─── Contradiction Detection ────────────────────────────────────────────────

/**
 * Detect if a new stance contradicts a previous stance by the same member.
 * Returns a description of the contradiction, or null if none.
 */
export function detectContradictions(
  memory: DebateMemory,
  newStance: Stance,
): string | null {
  const previous = memory.stances.filter(
    s => s.member === newStance.member && s.target === newStance.target,
  )

  for (const prev of previous) {
    if (prev.position === 'for' && newStance.position === 'against') {
      return `${newStance.member} previously supported "${newStance.target}" (R${prev.round}) but now opposes it`
    }
    if (prev.position === 'against' && newStance.position === 'for') {
      return `${newStance.member} previously opposed "${newStance.target}" (R${prev.round}) but now supports it`
    }
  }

  return null
}
