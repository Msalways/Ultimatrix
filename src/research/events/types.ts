/**
 * ResearchEvent types (Phase 4).
 *
 * Execution events describe what happened operationally. Research events
 * describe what happened semantically — the investigation-level narrative.
 */

export type ResearchEventType =
  | 'opportunity.created'
  | 'investigation.started'
  | 'candidate.created'
  | 'finding.validated'
  | 'finding.rejected'
  | 'false_positive.identified'
  | 'technique.succeeded'
  | 'technique.failed'
  | 'human.corrected'

export interface ResearchEvent {
  eventId: string
  runId: string
  opportunityId?: string
  taskId?: string
  experimentId?: string
  candidateId?: string
  findingId?: string
  skillId?: string
  type: ResearchEventType
  reasonCode?: string
  evidenceRefs: string[]
  timestamp: number
}
