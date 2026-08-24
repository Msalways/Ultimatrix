/**
 * WorkflowStore — typed persistence boundary for `WorkflowState` (slice 02).
 *
 * Responsibilities:
 * - Create fresh workflow state or load a persisted snapshot for a target.
 * - Persist snapshots to a per-target `workflow.json`.
 * - Typed mutators that update the state through explicit APIs.
 * - Sync helpers that fold session-scoped data (model usage, evidence) into
 *   the workflow, filtered by the workflow's own lifetime so prior sessions do
 *   not leak into a resumed workflow.
 *
 * Security: no raw content is persisted beyond `SpiderRuntimeState` and typed
 * id-based refs. Artifact/evidence refs never carry data blobs.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getGlobalWorkspace } from '../workspace'
import type { ArtifactRecord } from '../security/artifacts'
import type { SpiderRuntimeState } from '../spider/runtime'
import type { UsageEntry } from '../usage/tracker'
import type { EvidenceItem } from '../intelligence/evidence-ledger'
import type { ReachabilityRecord } from '../identity/types'
import { reachabilityKey } from '../identity/reachability'
import type { BrowserProviderName } from '../browser/provider'
import { isBrowserProviderName } from '../browser/provider'
import { redactObject, redactUrl } from '../security/secret-vault'
import {
  WORKFLOW_STATE_VERSION,
  type WorkflowState,
  type WorkflowStatus,
  type WorkerState,
  type TaskState,
  type ModelUsageSummary,
  type WorkflowEvidenceRef,
  type TaskAttemptState,
  type TaskContextCheckpoint,
  type TaskRetryableStatus,
} from './types'

const WORKFLOW_STATUSES: readonly WorkflowStatus[] = ['pending', 'running', 'paused', 'completed', 'failed', 'aborted']

/** Per-target workflow snapshot location (target slug dir). */
export function getWorkflowPath(target: string): string {
  return resolve(getGlobalWorkspace().getTargetDir(target), 'workflow.json')
}

export function createWorkflow(
  target: string,
  workflowId = `workflow-${randomUUID()}`,
  browserSessionId?: string,
  browserProvider?: BrowserProviderName,
): WorkflowState {
  const now = new Date().toISOString()
  return {
    version: WORKFLOW_STATE_VERSION,
    workflowId,
    target,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    browserSessionId,
    browserProvider,
    spider: undefined,
    modelUsage: [],
    tasks: [],
    activeWorkers: [],
    artifacts: [],
    evidenceRefs: [],
    decisionLedgerId: undefined,
    reachability: [],
  }
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === 'string' && WORKFLOW_STATUSES.includes(value as WorkflowStatus)
}

const RETRYABLE_STATUSES: readonly TaskRetryableStatus[] = ['failed', 'timed_out', 'interrupted']
const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0, reportedCalls: 0 }

function coerceAttempts(value: unknown): TaskAttemptState[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const attempt = item as Partial<TaskAttemptState>
    if (typeof attempt.attemptId !== 'string' || typeof attempt.number !== 'number' || typeof attempt.status !== 'string') return []
    return [{
      ...attempt,
      attemptId: attempt.attemptId,
      number: attempt.number,
      status: attempt.status as TaskAttemptState['status'],
      evidenceRefs: Array.isArray(attempt.evidenceRefs) ? attempt.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [],
      graphRefs: Array.isArray(attempt.graphRefs) ? attempt.graphRefs.filter((ref): ref is string => typeof ref === 'string') : [],
      usage: attempt.usage && typeof attempt.usage === 'object' ? { ...EMPTY_USAGE, ...attempt.usage } : { ...EMPTY_USAGE },
    }]
  })
}

function coerceContextCheckpoints(value: unknown): TaskContextCheckpoint[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is TaskContextCheckpoint => Boolean(
    item && typeof item === 'object' && typeof item.checkpointId === 'string' && typeof item.createdAt === 'number' &&
    Array.isArray(item.contextRefs) && Array.isArray(item.dependencies) && Array.isArray(item.priorAttempts),
  ))
}

function coerceTask(value: unknown): TaskState | null {
  if (!value || typeof value !== 'object') return null
  const task = value as Partial<TaskState>
  if (typeof task.taskId !== 'string' || typeof task.objective !== 'string' || typeof task.status !== 'string') return null
  return {
    ...task,
    taskId: task.taskId,
    objective: task.objective,
    dependencyTaskIds: Array.isArray(task.dependencyTaskIds) ? task.dependencyTaskIds : [],
    contextRefs: Array.isArray(task.contextRefs) ? task.contextRefs : [],
    requiredCapabilities: Array.isArray(task.requiredCapabilities) ? task.requiredCapabilities : [],
    acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
    acceptanceResults: Array.isArray(task.acceptanceResults) ? task.acceptanceResults : [],
    budget: task.budget && typeof task.budget === 'object' ? task.budget : {},
    retryPolicy: {
      maxAttempts: Number.isInteger(task.retryPolicy?.maxAttempts) && task.retryPolicy!.maxAttempts > 0 ? task.retryPolicy!.maxAttempts : 1,
      retryOn: Array.isArray(task.retryPolicy?.retryOn)
        ? task.retryPolicy.retryOn.filter((status): status is TaskRetryableStatus => RETRYABLE_STATUSES.includes(status as TaskRetryableStatus))
        : [],
      backoffMs: typeof task.retryPolicy?.backoffMs === 'number' && task.retryPolicy.backoffMs >= 0 ? task.retryPolicy.backoffMs : 0,
    },
    status: task.status as TaskState['status'],
    attempts: typeof task.attempts === 'number' ? task.attempts : 0,
    attemptHistory: coerceAttempts(task.attemptHistory),
    evidenceRefs: Array.isArray(task.evidenceRefs) ? task.evidenceRefs : [],
    graphRefs: Array.isArray(task.graphRefs) ? task.graphRefs : [],
    usage: task.usage && typeof task.usage === 'object' ? { ...EMPTY_USAGE, ...task.usage } : { ...EMPTY_USAGE },
    contextCheckpoints: coerceContextCheckpoints(task.contextCheckpoints),
    createdAt: typeof task.createdAt === 'number' ? task.createdAt : 0,
    updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : 0,
  }
}

function coerceReachability(value: unknown): ReachabilityRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ReachabilityRecord>
  if (typeof record.workflowId !== 'string' || typeof record.identityId !== 'string' || typeof record.resourceId !== 'string' || typeof record.reachedAt !== 'string') return null
  if (!['page', 'endpoint', 'form', 'workflow'].includes(record.resourceType ?? '')) return null
  const identity = record.identity && typeof record.identity === 'object'
    ? record.identity
    : { id: record.identityId, kind: 'unknown' as const }
  return {
    workflowId: record.workflowId,
    identityId: record.identityId,
    resourceId: record.resourceId,
    resourceType: record.resourceType!,
    reachedAt: record.reachedAt,
    identity,
    observedAt: typeof record.observedAt === 'string' ? record.observedAt : record.reachedAt,
  }
}

/**
 * Validate a persisted snapshot. Returns `null` when the payload is unusable:
 * incompatible version, missing workflowId, or a target mismatch. The caller
 * then falls back to a fresh workflow — a version mismatch is never silently
 * accepted. Missing optional fields load safely as empty/undefined.
 */
export function coerceWorkflow(value: unknown, fallback: { target: string }): WorkflowState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 && candidate.version !== 2 && candidate.version !== WORKFLOW_STATE_VERSION) return null
  if (typeof candidate.workflowId !== 'string' || candidate.workflowId.length === 0) return null
  if (typeof candidate.target !== 'string' || redactUrl(candidate.target) !== redactUrl(fallback.target)) return null

  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString()
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt

  return {
    version: WORKFLOW_STATE_VERSION,
    workflowId: candidate.workflowId,
    target: candidate.target,
    createdAt,
    updatedAt,
    status: isWorkflowStatus(candidate.status) ? candidate.status : 'pending',
    browserSessionId: typeof candidate.browserSessionId === 'string' ? candidate.browserSessionId : undefined,
    browserProvider: isBrowserProviderName(candidate.browserProvider) ? candidate.browserProvider : undefined,
    spider: candidate.spider && typeof candidate.spider === 'object'
      ? { ...(candidate.spider as SpiderRuntimeState), reachability: Array.isArray((candidate.spider as SpiderRuntimeState).reachability) ? (candidate.spider as SpiderRuntimeState).reachability.map(coerceReachability).filter((record): record is ReachabilityRecord => record !== null) : [] }
      : undefined,
    modelUsage: Array.isArray(candidate.modelUsage) ? (candidate.modelUsage as ModelUsageSummary[]) : [],
    tasks: Array.isArray(candidate.tasks) ? candidate.tasks.map(coerceTask).filter((task): task is TaskState => task !== null) : [],
    activeWorkers: Array.isArray(candidate.activeWorkers) ? (candidate.activeWorkers as WorkerState[]) : [],
    artifacts: Array.isArray(candidate.artifacts) ? (candidate.artifacts as WorkflowState['artifacts']) : [],
    evidenceRefs: Array.isArray(candidate.evidenceRefs) ? (candidate.evidenceRefs as WorkflowEvidenceRef[]) : [],
    decisionLedgerId: typeof candidate.decisionLedgerId === 'string' ? candidate.decisionLedgerId : undefined,
    reachability: Array.isArray(candidate.reachability) ? candidate.reachability.map(coerceReachability).filter((record): record is ReachabilityRecord => record !== null) : [],
    captureSource:
      candidate.captureSource === 'cdp' || candidate.captureSource === 'anonymous-fallback'
        ? candidate.captureSource
        : undefined,
  }
}

export interface WorkflowLoadOptions {
  target: string
  workflowId?: string
  browserSessionId?: string
  /** Slice 05 — the provider this session intends to use; rejects a resume against a different persisted provider. */
  browserProvider?: BrowserProviderName
}

export class WorkflowStore {
  readonly state: WorkflowState

  private constructor(
    private readonly path: string,
    state: WorkflowState,
  ) {
    this.state = state
  }

  /** Load a persisted workflow for `target`, or create + persist a fresh one. */
  static async loadOrCreate(path: string, opts: WorkflowLoadOptions): Promise<WorkflowStore> {
    let loaded: WorkflowState | null = null
    try {
      const raw = await readFile(path, 'utf8')
      loaded = coerceWorkflow(JSON.parse(raw), { target: opts.target })
    } catch {
      // Missing or invalid workflow file starts a fresh workflow below.
    }
    if (loaded) {
      // Slice 05 — one workflow maps to one browser provider. Resume with a
      // different provider than the one that created the workflow is a hard
      // error (fail clearly, never silently reuse the wrong browser).
      if (opts.browserProvider && loaded.browserProvider && loaded.browserProvider !== opts.browserProvider) {
        throw new Error(
          `Workflow ${loaded.workflowId} for ${opts.target} was created with browser provider '${loaded.browserProvider}' ` +
            `but this run requests '${opts.browserProvider}'. One workflow maps to one browser provider — resume with ` +
            `the original provider or target a fresh workflow.`,
        )
      }
      return new WorkflowStore(path, loaded)
    }
    const store = new WorkflowStore(
      path,
      createWorkflow(opts.target, opts.workflowId, opts.browserSessionId, opts.browserProvider),
    )
    await store.save()
    return store
  }

  async save(): Promise<void> {
    this.touch()
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    const durable = redactObject(this.state) as WorkflowState
    durable.browserSessionId = this.state.browserSessionId
    await writeFile(temporaryPath, JSON.stringify(durable, null, 2), 'utf8')
    await rename(temporaryPath, this.path)
  }

  // ── Typed mutators ────────────────────────────────────────────────

  setStatus(status: WorkflowStatus): void {
    this.state.status = status
    this.touch()
  }

  setBrowserSessionId(id: string | undefined): void {
    if (id) this.state.browserSessionId = id
    this.touch()
  }

  /** Slice 05 — record the provider fixed for this workflow. */
  setBrowserProvider(provider: BrowserProviderName | undefined): void {
    if (provider) this.state.browserProvider = provider
    this.touch()
  }

  /** C9 — record how session traffic is captured (live vs anonymous fallback). */
  setCaptureSource(source: 'cdp' | 'anonymous-fallback'): void {
    this.state.captureSource = source
    this.touch()
  }

  setDecisionLedgerId(id: string | undefined): void {
    if (id) this.state.decisionLedgerId = id
    this.touch()
  }

  /** Attach (or replace) the crawl state after a spider run. */
  attachSpider(spider: SpiderRuntimeState): void {
    this.state.spider = spider
    this.state.status = 'running'
    // Slice 06 — fold the crawl's reachability observations into the workflow
    // top-level so identity → resource reachability survives resume even before
    // a spider snapshot is attached.
    for (const record of spider.reachability ?? []) {
      this.recordReachability(record)
    }
    this.touch()
  }

  /** Slice 06 — record a reachability observation (deduped per identity+resource). */
  recordReachability(record: ReachabilityRecord): void {
    if (this.state.reachability.some((r) => reachabilityKey(r) === reachabilityKey(record))) return
    this.state.reachability.push(record)
    this.touch()
  }

  /** Upsert a worker snapshot by workerId. */
  recordWorker(worker: WorkerState): void {
    const index = this.state.activeWorkers.findIndex((w) => w.workerId === worker.workerId)
    if (index >= 0) this.state.activeWorkers[index] = worker
    else this.state.activeWorkers.push(worker)
    this.touch()
  }

  /** Upsert a durable task independently of any worker instance assigned to it. */
  recordTask(task: TaskState): void {
    const index = this.state.tasks.findIndex((item) => item.taskId === task.taskId)
    if (index >= 0) this.state.tasks[index] = task
    else this.state.tasks.push(task)
    this.touch()
  }

  /** Record a durable artifact (slice 04) belonging to this workflow. */
  recordArtifact(record: ArtifactRecord): void {
    if (record.workflowId !== this.state.workflowId) return
    if (this.state.artifacts.some((a) => a.id === record.id)) return
    this.state.artifacts.push({
      id: record.id,
      kind: record.kind,
      status: record.status,
      path: record.path,
      createdAt: record.createdAt,
    })
    this.touch()
  }

  /** Record a compact evidence reference (no raw data). */
  recordEvidence(ref: WorkflowEvidenceRef): void {
    if (this.state.evidenceRefs.some((e) => e.id === ref.id)) return
    this.state.evidenceRefs.push(ref)
    this.touch()
  }

  /**
   * Fold session-scoped usage entries into `modelUsage`, aggregated per
   * provider/model and filtered to this workflow's own lifetime so a resumed
   * workflow does not inherit entries from an earlier session.
   */
  syncModelUsage(entries: UsageEntry[], since = Date.parse(this.state.createdAt)): void {
    const seen = new Map<string, ModelUsageSummary>()
    for (const entry of entries) {
      if (entry.timestamp < since) continue
      const key = `${entry.provider}/${entry.model}`
      const existing = seen.get(key)
      if (existing) {
        existing.inputTokens += entry.inputTokens
        existing.outputTokens += entry.outputTokens
        existing.totalTokens += entry.totalTokens
        existing.calls += 1
        existing.lastUsedAt = Math.max(existing.lastUsedAt, entry.timestamp)
      } else {
        seen.set(key, {
          provider: entry.provider,
          model: entry.model,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          totalTokens: entry.totalTokens,
          calls: 1,
          lastUsedAt: entry.timestamp,
        })
      }
    }
    this.state.modelUsage = Array.from(seen.values())
    this.touch()
  }

  /** Fold session-scoped evidence items into compact refs (same lifetime filter). */
  syncEvidence(items: EvidenceItem[], since = Date.parse(this.state.createdAt)): void {
    this.state.evidenceRefs = items
      .filter((item) => item.timestamp >= since)
      .map((item) => ({
        id: item.id,
        kind: item.type,
        label: item.label,
        recordedAt: item.timestamp,
      }))
    this.touch()
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString()
  }
}
