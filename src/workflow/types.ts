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
import type { BrowserProviderName } from '../browser/provider'

export const WORKFLOW_STATE_VERSION = 3 as const
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

export type TaskLifecycleStatus =
  | 'planned'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'budget_exceeded'
  | 'budget_unverifiable'

export type TaskAcceptanceCriterion =
  | {
      id: string
      description: string
      type: 'summary_present'
    }
  | {
      id: string
      description: string
      type: 'evidence_count'
      minCount: number
    }

export interface TaskAcceptanceResult {
  id: string
  passed: boolean
  actual: string
}

export interface TaskBudget {
  tokenLimit?: number
  timeoutMs?: number
}

export type TaskRetryableStatus = 'failed' | 'timed_out' | 'interrupted'

export interface TaskRetryPolicy {
  maxAttempts: number
  retryOn: TaskRetryableStatus[]
  backoffMs: number
}

export type TaskAttemptStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'interrupted' | 'budget_exceeded' | 'budget_unverifiable'

export interface TaskUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  modelCalls: number
  reportedCalls: number
}

export interface TaskAttemptState {
  attemptId: string
  number: number
  status: TaskAttemptStatus
  workerId?: string
  modelId?: string
  provider?: string
  startedAt?: number
  completedAt?: number
  resultSummary?: string
  evidenceRefs: string[]
  graphRefs: string[]
  usage: TaskUsage
  contextCheckpointId?: string
  error?: string
}

export interface TaskWaitState {
  reason: string
  inputKey?: string
  requestedAt: number
}

export interface TaskDependencyContext {
  taskId: string
  status: TaskLifecycleStatus | 'missing'
  summary?: string
  evidenceRefs: string[]
  graphRefs: string[]
}

export interface TaskContextCheckpoint {
  checkpointId: string
  createdAt: number
  contextRefs: string[]
  dependencies: TaskDependencyContext[]
  priorAttempts: Array<{ attemptId: string; status: TaskAttemptStatus; summary?: string }>
}

/** Durable assignment state. Unlike WorkerState, this survives worker replacement and retries. */
export interface TaskState {
  taskId: string
  objective: string
  skillId?: string
  parentTaskId?: string
  dependencyTaskIds: string[]
  contextRefs: string[]
  requiredCapabilities: string[]
  complexity?: 'low' | 'medium' | 'high' | 'critical'
  acceptanceCriteria: TaskAcceptanceCriterion[]
  acceptanceResults: TaskAcceptanceResult[]
  budget: TaskBudget
  retryPolicy: TaskRetryPolicy
  status: TaskLifecycleStatus
  attempts: number
  attemptHistory: TaskAttemptState[]
  workerId?: string
  modelId?: string
  provider?: string
  tier?: string
  resultSummary?: string
  evidenceRefs: string[]
  graphRefs: string[]
  usage: TaskUsage
  contextCheckpoints: TaskContextCheckpoint[]
  wait?: TaskWaitState
  error?: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
}

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
  /** Slice 05 — provider fixed for the workflow's lifetime (resume mismatch rejects). */
  browserProvider?: BrowserProviderName
  spider?: SpiderRuntimeState
  /**
   * C9 — how session traffic was captured. 'anonymous-fallback' marks the
   * standalone-headless capture (separate cold browser, no session cookies)
   * so consumers can distinguish it from live in-session capture.
   */
  captureSource?: 'cdp' | 'anonymous-fallback'
  modelUsage: ModelUsageSummary[]
  /** Canonical durable work records. activeWorkers remains an execution snapshot. */
  tasks: TaskState[]
  activeWorkers: WorkerState[]
  artifacts: WorkflowArtifactRef[]
  evidenceRefs: WorkflowEvidenceRef[]
  decisionLedgerId?: string
  /** Slice 06 — identity → resource reachability observations (survive resume). */
  reachability: ReachabilityRecord[]
}
