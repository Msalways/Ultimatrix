/**
 * Opportunity Store (Phase 2).
 *
 * Manages the lifecycle of ResearchOpportunities. Handles deduplication,
 * status transitions, and persistence to the knowledge graph.
 */

import type {
  ResearchOpportunity,
  OpportunitySignal,
  OpportunityStatus,
  OpportunityKillReason,
} from './types'

/** Dedup key: normalized signal fingerprint */
function dedupKey(targetRef: string, signal: OpportunitySignal): string {
  return `${targetRef}:${signal.type}:${signal.source}`
}

/** In-memory opportunity store */
const opportunities = new Map<string, ResearchOpportunity>()
let nextId = 1

/**
 * Create or update an opportunity from a signal.
 * If a matching opportunity already exists (same target + signal), increments
 * seenCount and updates lastSeenAt. Otherwise creates a new one.
 */
export function createOrUpdate(
  runId: string,
  targetRef: string,
  signal: OpportunitySignal,
  opts: {
    title?: string
    summary?: string
    evidenceRefs?: string[]
    artifactRefs?: string[]
    suggestedSkills?: ResearchOpportunity['suggestedSkills']
    priority?: number
  } = {},
): ResearchOpportunity {
  const key = dedupKey(targetRef, signal)
  const now = Date.now()

  // Check for existing
  for (const opp of opportunities.values()) {
    if (opp.runId === runId && dedupKey(opp.targetRef, opp.signal) === key) {
      opp.lastSeenAt = now
      opp.seenCount++
      // Merge evidence refs
      if (opts.evidenceRefs) {
        for (const ref of opts.evidenceRefs) {
          if (!opp.evidenceRefs.includes(ref)) opp.evidenceRefs.push(ref)
        }
      }
      // Update priority if higher
      if (opts.priority !== undefined && opts.priority > opp.priority) {
        opp.priority = opts.priority
      }
      return opp
    }
  }

  // Create new
  const id = `opp-${nextId++}`
  const opportunity: ResearchOpportunity = {
    id,
    runId,
    targetRef,
    title: opts.title ?? signal.type,
    summary: opts.summary ?? `${signal.type} observed from ${signal.source}`,
    signal,
    evidenceRefs: opts.evidenceRefs ?? [],
    artifactRefs: opts.artifactRefs ?? [],
    suggestedSkills: opts.suggestedSkills ?? [],
    priority: opts.priority ?? 50,
    status: 'new',
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 1,
    taskRefs: [],
    candidateRefs: [],
  }

  opportunities.set(id, opportunity)
  return opportunity
}

/**
 * Get an opportunity by ID.
 */
export function getById(id: string): ResearchOpportunity | undefined {
  return opportunities.get(id)
}

/**
 * Get all opportunities for a run.
 */
export function getByRun(runId: string): ResearchOpportunity[] {
  return [...opportunities.values()].filter(o => o.runId === runId)
}

/**
 * Get all active (non-killed, non-promoted) opportunities for a run.
 */
export function getActive(runId: string): ResearchOpportunity[] {
  return getByRun(runId).filter(o =>
    o.status === 'new' || o.status === 'investigating' || o.status === 'parked',
  )
}

/**
 * Update an opportunity's status.
 */
export function updateStatus(
  id: string,
  status: OpportunityStatus,
): ResearchOpportunity | undefined {
  const opp = opportunities.get(id)
  if (!opp) return undefined
  opp.status = status
  return opp
}

/**
 * Promote an opportunity to a task.
 */
export function promote(id: string, taskId: string): ResearchOpportunity | undefined {
  const opp = opportunities.get(id)
  if (!opp) return undefined
  opp.status = 'promoted'
  if (!opp.taskRefs.includes(taskId)) opp.taskRefs.push(taskId)
  return opp
}

/**
 * Kill an opportunity with a reason.
 */
export function kill(id: string, reason: OpportunityKillReason): ResearchOpportunity | undefined {
  const opp = opportunities.get(id)
  if (!opp) return undefined
  opp.status = 'killed'
  opp.killReason = reason
  opp.killedAt = Date.now()
  return opp
}

/**
 * Add a candidate finding ref to an opportunity.
 */
export function addCandidate(id: string, candidateId: string): ResearchOpportunity | undefined {
  const opp = opportunities.get(id)
  if (!opp) return undefined
  if (!opp.candidateRefs.includes(candidateId)) opp.candidateRefs.push(candidateId)
  return opp
}

/**
 * Clear all opportunities (for tests).
 */
export function clearOpportunities(): void {
  opportunities.clear()
  nextId = 1
}
