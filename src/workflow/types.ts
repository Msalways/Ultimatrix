/**
 * Workflow State — Slice 02.
 *
 * A single workflow-owned state object that embeds the crawl state
 * (`SpiderRuntimeState`) and carries typed references to the browser session,
 * model usage, active workers, artifacts, and evidence recorded during the
 * engagement. Persistence stores SNAPSHOTS of this state, never subsystem
 * internals, so a run can be resumed without losing operational context.
 *
 * Versioning: `WorkflowState.version` gates load — a persisted state with a
 * version this build does not understand is refused (never silently ignored),
 * and the caller falls back to a fresh workflow.
 *
 * No regex/keyword detection anywhere: refs are typed, id-based pointers.
 */

import type { SpiderRuntimeState } from '../spider/runtime'
import type { ArtifactKind, ArtifactStatus } from '../security/artifacts'
import type { ReachabilityRecord } from '../identity/types'

export const WORKFLOW_STATE_VERSION = 1 as const
export type WorkflowStateVersion = typeof WORKFLOW_STATE_VERSION

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted'

/** Aggregated per-model token usage (see src/usage/tracker.ts). */
export interface ModelUsageSummary {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  calls: number
  lastUsedAt: number
}

export type WorkerLifecycleStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout' | 'killed'

/** Snapshot of an active/terminal worker within this workflow. */
export interface WorkerState {
  workerId: string
  skillId: string
  task: string
  status: WorkerLifecycleStatus
  modelId?: string
  provider?: string
  tier?: string
  tokenBudget?: number
  startedAt?: number
  completedAt?: number
  error?: string
  resultSummary?: string
}

/** Reference to a durable artifact record (slice 04). Never carries raw content. */
export interface WorkflowArtifactRef {
  id: string
  kind: ArtifactKind
  status: ArtifactStatus
  path?: string
  createdAt: string
}

/** Reference to a recorded evidence item (EvidenceLedger). Never carries raw data. */
export interface WorkflowEvidenceRef {
  id: string
  kind: string
  label?: string
  ref?: string
  recordedAt: number
}

export interface WorkflowState {
  version: WorkflowStateVersion
  workflowId: string
  target: string
  createdAt: string
  updatedAt: string
  status: WorkflowStatus
  browserSessionId?: string
  spider?: SpiderRuntimeState
  modelUsage: ModelUsageSummary[]
  activeWorkers: WorkerState[]
  artifacts: WorkflowArtifactRef[]
  evidenceRefs: WorkflowEvidenceRef[]
  decisionLedgerId?: string
  /** Slice 06 — identity → resource reachability observations (survive resume). */
  reachability: ReachabilityRecord[]
}
