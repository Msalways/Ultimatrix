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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
import {
  WORKFLOW_STATE_VERSION,
  type WorkflowState,
  type WorkflowStatus,
  type WorkerState,
  type ModelUsageSummary,
  type WorkflowEvidenceRef,
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

/**
 * Validate a persisted snapshot. Returns `null` when the payload is unusable:
 * incompatible version, missing workflowId, or a target mismatch. The caller
 * then falls back to a fresh workflow — a version mismatch is never silently
 * accepted. Missing optional fields load safely as empty/undefined.
 */
export function coerceWorkflow(value: unknown, fallback: { target: string }): WorkflowState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.version !== WORKFLOW_STATE_VERSION) return null
  if (typeof candidate.workflowId !== 'string' || candidate.workflowId.length === 0) return null
  if (typeof candidate.target !== 'string' || candidate.target !== fallback.target) return null

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
    spider: candidate.spider && typeof candidate.spider === 'object' ? (candidate.spider as SpiderRuntimeState) : undefined,
    modelUsage: Array.isArray(candidate.modelUsage) ? (candidate.modelUsage as ModelUsageSummary[]) : [],
    activeWorkers: Array.isArray(candidate.activeWorkers) ? (candidate.activeWorkers as WorkerState[]) : [],
    artifacts: Array.isArray(candidate.artifacts) ? (candidate.artifacts as WorkflowState['artifacts']) : [],
    evidenceRefs: Array.isArray(candidate.evidenceRefs) ? (candidate.evidenceRefs as WorkflowEvidenceRef[]) : [],
    decisionLedgerId: typeof candidate.decisionLedgerId === 'string' ? candidate.decisionLedgerId : undefined,
    reachability: Array.isArray(candidate.reachability) ? (candidate.reachability as ReachabilityRecord[]) : [],
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
      loaded = null
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
    await writeFile(this.path, JSON.stringify(this.state, null, 2), 'utf8')
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
