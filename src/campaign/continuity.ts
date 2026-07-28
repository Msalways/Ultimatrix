/**
 * Campaign Continuity — Phase 4 / T4.2
 *
 * Adds continuity between campaign runs:
 *   - app-state hashing (what the target "looks like" right now)
 *   - change detection (did the app change since the last run?)
 *   - incremental re-test planning (only re-test what changed or was queued)
 *   - a persistent backlog of findings/endpoints scheduled for re-test
 *
 * All persistence rides on the existing GraphStore addNode/upsertNode/getNode
 * API so the store internals are untouched and survive save()/load().
 */

import { createHash } from 'node:crypto'
import { NodeType } from '../graph/schema'
import type { EndpointNode, AuthSchemeNode, FindingNode, GraphNodeData, FactNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { UltimatrixConfig } from '../config'
import { runCampaign } from './executor'
import { planCampaign } from './planner'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import type {
  CampaignPlan,
  CampaignExecutorOptions,
  CampaignResult,
  CoverageStats,
  PlanOptions,
  PrimitiveRef,
} from './types'

// ─── Node id / markers (persisted as lightweight Fact nodes) ───────────

const APP_HASH_ID = 'meta:continuity:apphash'
const BACKLOG_PREFIX = 'backlog:'
const BACKLOG_MARKER = '__continuity_backlog__'

export interface BacklogItem {
  id: string
  /** What kind of target is queued for re-test. */
  kind: 'endpoint' | 'finding'
  /** Endpoint id/url, or Finding node id. */
  target: string
  reason: string
  addedAt: number
  status: 'pending' | 'done'
  priority?: number
}

export type RetestPlanOptions = PlanOptions & {
  /** Only re-test backlog targets, ignore app-state changes. */
  backlogOnly?: boolean
}

// ─── Stable JSON serialization (order-independent for stable hashing) ──

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).sort() + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return (
    '{' +
    keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',') +
    '}'
  )
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// ─── Per-endpoint / app-state hashing ─────────────────────────────────

function hashEndpoint(ep: EndpointNode): string {
  const shape = {
    url: ep.properties.url,
    method: ep.properties.method?.toUpperCase(),
    params: ep.properties.params ?? [],
    headers: ep.properties.headers ?? {},
    useCase: ep.properties.useCase,
    preconditions: ep.properties.preconditions ?? [],
    authRequired: ep.properties.authRequired,
    authType: ep.properties.authType,
  }
  return shortHash(stableStringify(shape))
}

/**
 * Compute a stable hash of the target's relevant state: every endpoint
 * (params/headers/useCase/invariants/auth) plus the discovered auth schemes.
 * This represents "what the app looks like" for change detection.
 */
export function hashAppState(graphStore: GraphStore): string {
  const endpoints = graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const authSchemes = graphStore.queryNodes(NodeType.AUTH_SCHEME) as AuthSchemeNode[]

  const endpointHashes: Record<string, string> = {}
  for (const ep of endpoints) endpointHashes[ep.id] = hashEndpoint(ep)

  const authShape = authSchemes.map(a => ({
    scheme: a.properties.scheme,
    reusedAcross: a.properties.reusedAcross ?? [],
    decoded: a.properties.decoded,
  }))

  return shortHash(
    stableStringify({ endpoints: endpointHashes, authSchemes: authShape }),
  )
}

/** Compute the per-endpoint hash map (endpointId -> hash). */
function computeEndpointHashes(graphStore: GraphStore): Record<string, string> {
  const endpoints = graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const map: Record<string, string> = {}
  for (const ep of endpoints) map[ep.id] = hashEndpoint(ep)
  return map
}

// ─── App-hash persistence (survives save/load via Fact node) ──────────

interface AppHashRecord {
  hash: string
  endpointHashes: Record<string, string>
}

function getAppHashRecord(store: GraphStore): AppHashRecord | undefined {
  const node = store.getNode(APP_HASH_ID) as GraphNodeData | undefined
  if (!node) return undefined
  const props = node.properties as Record<string, unknown>
  return {
    hash: typeof props.hash === 'string' ? (props.hash as string) : '',
    endpointHashes:
      (props.endpointHashes as Record<string, string>) ?? {},
  }
}

function persistAppState(
  store: GraphStore,
  hash: string,
  endpointHashes: Record<string, string>,
): void {
  const now = Date.now()
  const existing = store.getNode(APP_HASH_ID) as GraphNodeData | undefined
  store.upsertNode({
    id: APP_HASH_ID,
    type: NodeType.FACT,
    label: 'AppStateHash',
    properties: {
      description: 'app-state-hash',
      source: 'continuity',
      hash,
      endpointHashes,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}

/** Persist the full app-state hash (preserving previously stored endpoint hashes). */
export function recordAppHash(store: GraphStore, hash: string): void {
  const prev = getAppHashRecord(store)
  persistAppState(store, hash, prev?.endpointHashes ?? {})
}

/** Read the last persisted app-state hash, if any. */
export function getLastAppHash(store: GraphStore): string | undefined {
  return getAppHashRecord(store)?.hash
}

/** Did the app state change between two hashes? */
export function detectChanges(
  prevHash: string | undefined,
  currHash: string,
): boolean {
  return prevHash !== currHash
}

// ─── Backlog management (persisted as Fact nodes) ─────────────────────

function backlogNodeId(id: string): string {
  return `${BACKLOG_PREFIX}${id}`
}

/** Queue a finding/endpoint for re-test. Idempotent by id. */
export function addToBacklog(store: GraphStore, item: BacklogItem): BacklogItem {
  const now = Date.now()
  const existing = store.getNode(backlogNodeId(item.id)) as GraphNodeData | undefined
  const node: GraphNodeData = {
    id: backlogNodeId(item.id),
    type: NodeType.FACT,
    label: `Backlog: ${item.kind}:${item.target}`,
    properties: {
      [BACKLOG_MARKER]: true,
      backlogId: item.id,
      kind: item.kind,
      target: item.target,
      reason: item.reason,
      addedAt: item.addedAt ?? now,
      status: item.status ?? 'pending',
      priority: item.priority,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  store.upsertNode(node)
  return {
    id: item.id,
    kind: item.kind,
    target: item.target,
    reason: item.reason,
    addedAt: node.properties.addedAt as number,
    status: node.properties.status as 'pending' | 'done',
    priority: node.properties.priority as number | undefined,
  }
}

/** Return all backlog items (pending + done), newest first. */
export function getBacklog(store: GraphStore): BacklogItem[] {
  const facts = store.queryNodes(NodeType.FACT) as FactNode[]
  return facts
    .filter(f => (f.properties as Record<string, unknown>)[BACKLOG_MARKER] === true)
    .map(f => {
      const p = f.properties as Record<string, unknown>
      return {
        id: p.backlogId as string,
        kind: p.kind as 'endpoint' | 'finding',
        target: p.target as string,
        reason: p.reason as string,
        addedAt: p.addedAt as number,
        status: p.status as 'pending' | 'done',
        priority: p.priority as number | undefined,
      }
    })
    .sort((a, b) => b.addedAt - a.addedAt)
}

/** Return only pending backlog items. */
export function getPendingBacklog(store: GraphStore): BacklogItem[] {
  return getBacklog(store).filter(b => b.status === 'pending')
}

/** Mark a backlog item as done (no-op if not present). */
export function markBacklogDone(store: GraphStore, id: string): void {
  const node = store.getNode(backlogNodeId(id)) as GraphNodeData | undefined
  if (!node) return
  store.upsertNode({
    ...node,
    properties: {
      ...node.properties,
      status: 'done',
    },
    updatedAt: Date.now(),
  })
}

/** Remove a backlog item entirely (pending or done). */
export function removeFromBacklog(store: GraphStore, id: string): void {
  store.deleteNode(backlogNodeId(id))
}

// ─── Re-test planning ─────────────────────────────────────────────────

function coverageForSlices(
  slices: CampaignPlan['slices'],
  base: CoverageStats,
): CoverageStats {
  const endpoints = new Set<string>()
  const params = new Set<string>()
  const roles = new Set<string>()
  const states = new Set<string>()
  const techniques = new Set<string>()
  for (const s of slices) {
    endpoints.add(s.endpoint.id)
    s.params.forEach(p => params.add(`${s.endpoint.id}#${p}`))
    roles.add(s.role)
    states.add(s.state)
    s.techniqueIds.forEach(t => techniques.add(t))
  }
  return {
    ...base,
    endpointsCovered: endpoints.size,
    paramsCovered: params.size,
    rolesCovered: roles.size,
    statesCovered: states.size,
    techniquesPlanned: techniques.size,
    slicesPlanned: slices.length,
    slicesExecuted: 0,
    slicesConfirmed: 0,
  }
}

interface RetestPlanResult {
  plan: CampaignPlan
  consumedBacklogIds: string[]
}

function buildRetestPlan(graphStore: GraphStore, options?: RetestPlanOptions): RetestPlanResult {
  const primitives = options?.primitives ?? []
  const backlogOnly = options?.backlogOnly ?? false

  const prev = getAppHashRecord(graphStore)
  const currentEndpointHashes = computeEndpointHashes(graphStore)

  // Targets that changed since the last recorded run.
  const changedEndpointIds = new Set<string>()
  if (!backlogOnly) {
    for (const [id, h] of Object.entries(currentEndpointHashes)) {
      if (prev?.endpointHashes?.[id] !== h) changedEndpointIds.add(id)
    }
  }

  // Targets queued in the backlog (endpoints + findings resolved to endpoints).
  const pending = getPendingBacklog(graphStore)
  const backlogEndpointIds = new Set<string>()
  const backlogEndpointUrls = new Set<string>()
  const consumedBacklogIds: string[] = []
  const findings = graphStore.queryNodes(NodeType.FINDING) as FindingNode[]

  for (const item of pending) {
    if (item.kind === 'endpoint') {
      backlogEndpointIds.add(item.target)
      // also match by url if the target is a url
      backlogEndpointUrls.add(item.target)
    } else {
      const f = findings.find(fn => fn.id === item.target)
      const epRef = f?.properties.endpoint
      if (epRef) {
        backlogEndpointUrls.add(epRef)
        // Try to find endpoint node whose url matches the finding endpoint.
        const ep = (graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]).find(
          e => e.properties.url === epRef,
        )
        if (ep) backlogEndpointIds.add(ep.id)
      }
    }
    consumedBacklogIds.push(item.id)
  }

  const basePlan = planCampaign(graphStore, { primitives, ...options } as PlanOptions)
  const filtered = basePlan.slices.filter(s => {
    if (changedEndpointIds.has(s.endpoint.id)) return true
    if (backlogEndpointIds.has(s.endpoint.id)) return true
    if (backlogEndpointUrls.has(s.endpoint.url)) return true
    return false
  })

  const plan: CampaignPlan = {
    slices: filtered,
    coverage: coverageForSlices(filtered, basePlan.coverage),
    generatedAt: Date.now(),
    options: { primitives, ...options },
  }
  return { plan, consumedBacklogIds }
}

/**
 * Build a re-test campaign plan: only endpoints that changed since the last
 * recorded run, plus any findings/endpoints queued in the backlog. Records the
 * current app-state hash so the next run can detect further changes.
 */
export function planRetest(graphStore: GraphStore, options?: RetestPlanOptions): CampaignPlan {
  const endpointHashes = computeEndpointHashes(graphStore)
  const fullHash = hashAppState(graphStore)
  persistAppState(graphStore, fullHash, endpointHashes)
  return buildRetestPlan(graphStore, options).plan
}

/**
 * Convenience: plan a re-test and execute it through the campaign executor.
 * After execution, backlog items consumed by the plan are marked done.
 */
export async function runRetest(
  graphStore: GraphStore,
  config: UltimatrixConfig,
  deps: {
    executor: CampaignExecutorOptions['executor']
    primitives: PrimitiveRef[]
    evidenceGate?: EvidenceGate
    onSliceComplete?: CampaignExecutorOptions['onSliceComplete']
    provider?: string
    maxConcurrency?: number
    modelSelector?: CampaignExecutorOptions['modelSelector']
    retestOptions?: RetestPlanOptions
    /** Mark consumed backlog items done after running. Default true. */
    markBacklogDoneAfterRun?: boolean
  },
): Promise<CampaignResult> {
  const { plan, consumedBacklogIds } = buildRetestPlan(graphStore, deps.retestOptions)
  const result = await runCampaign(plan, {
    graphStore,
    config,
    executor: deps.executor,
    evidenceGate: deps.evidenceGate,
    onSliceComplete: deps.onSliceComplete,
    provider: deps.provider,
    maxConcurrency: deps.maxConcurrency,
    modelSelector: deps.modelSelector,
  })
  if (deps.markBacklogDoneAfterRun !== false) {
    for (const id of consumedBacklogIds) markBacklogDone(graphStore, id)
  }
  return result
}
