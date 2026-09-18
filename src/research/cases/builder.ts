/**
 * Case Builder (Phase 4).
 *
 * Builds a ResearchCase from research events and evidence items.
 * Extracts hypothesis, counter-evidence, and outcome from structured events.
 */

import type { ResearchEvent } from '../events/types'
import type { ResearchCase, CaseOutcome } from './types'

let nextCaseId = 1

/**
 * Build a ResearchCase from a sequence of research events.
 *
 * @param events - Events for this investigation, ordered by timestamp
 * @param hypothesis - The initial hypothesis being tested
 * @param domain - Security domain (e.g., 'authorization', 'injection')
 * @param skillId - The skill used (if any)
 */
export function buildCase(
  events: ResearchEvent[],
  hypothesis: string,
  domain: string,
  skillId?: string,
): ResearchCase {
  const outcome = determineOutcome(events)
  const decisiveEvidence = extractDecisiveEvidence(events)
  const counterEvidence = extractCounterEvidence(events)
  const falsePositiveReason = extractFalsePositiveReason(events)
  const killSignal = extractKillSignal(events)
  const contextFeatures = extractContextFeatures(events)
  const sourceRefs = events.flatMap(e => e.evidenceRefs)

  const reusableLesson = buildReusableLesson(outcome, hypothesis, decisiveEvidence, counterEvidence, falsePositiveReason)

  return {
    id: `case-${nextCaseId++}`,
    domain,
    skillId,
    initialHypothesis: hypothesis,
    contextFeatures,
    decisiveEvidence,
    counterEvidence,
    outcome,
    falsePositiveReason,
    killSignal,
    reusableLesson,
    sourceRefs,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function determineOutcome(events: ResearchEvent[]): CaseOutcome {
  const hasValidated = events.some(e => e.type === 'finding.validated')
  const hasRejected = events.some(e => e.type === 'finding.rejected')
  const hasFalsePositive = events.some(e => e.type === 'false_positive.identified')

  if (hasValidated && !hasRejected) return 'validated'
  if (hasRejected || hasFalsePositive) return 'rejected'
  if (events.length > 0) return 'inconclusive'
  return 'inconclusive'
}

function extractDecisiveEvidence(events: ResearchEvent[]): string[] {
  return events
    .filter(e => e.type === 'finding.validated' || e.type === 'technique.succeeded')
    .map(e => e.reasonCode ?? `${e.type} at ${e.timestamp}`)
}

function extractCounterEvidence(events: ResearchEvent[]): string[] {
  return events
    .filter(e => e.type === 'finding.rejected' || e.type === 'false_positive.identified' || e.type === 'technique.failed')
    .map(e => e.reasonCode ?? `${e.type} at ${e.timestamp}`)
}

function extractFalsePositiveReason(events: ResearchEvent[]): string | undefined {
  const fpEvent = events.find(e => e.type === 'false_positive.identified')
  return fpEvent?.reasonCode
}

function extractKillSignal(events: ResearchEvent[]): string | undefined {
  const failEvents = events.filter(e => e.type === 'technique.failed' || e.type === 'finding.rejected')
  if (failEvents.length > 0) {
    return failEvents.map(e => e.reasonCode).filter(Boolean).join('; ')
  }
  return undefined
}

function extractContextFeatures(events: ResearchEvent[]): string[] {
  const features: string[] = []
  const skills = new Set(events.map(e => e.skillId).filter(Boolean))
  for (const skill of skills) features.push(`skill:${skill}`)
  return features
}

function buildReusableLesson(
  outcome: CaseOutcome,
  hypothesis: string,
  decisive: string[],
  counter: string[],
  fpReason?: string,
): string | undefined {
  if (outcome === 'rejected' && fpReason) {
    return `Hypothesis "${hypothesis}" was rejected. False positive reason: ${fpReason}. Lesson: ${counter.join('; ')}`
  }
  if (outcome === 'validated' && decisive.length > 0) {
    return `Hypothesis "${hypothesis}" was confirmed. Key evidence: ${decisive.join('; ')}`
  }
  return undefined
}
