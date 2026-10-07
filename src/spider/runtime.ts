import type { UltimatrixConfig, AuthorizationCategory, ScopeConfig } from '../config'
import { DEFAULTS } from '../config'
import { NodeType, type GraphNodeData } from '../graph/schema'
import { getGlobalEmitter } from '../events/emitter'
import {
  emitSpiderComplete,
  emitSpiderEndpoint,
  emitSpiderError,
  emitSpiderPage,
  emitSpiderStart,
  emitScopeProposed,
} from '../events/emitter'
import { bindScopeToTarget, isUrlInScope, isCategoryAuthorized, approveScopeOrigin, enforceAction } from '../safety/scope-guard'
import { getTargetTransportGovernor } from '../runtime/target-governor'
import { log } from '../utils/logger'
import { getGlobalDecisionLedger } from '../security/decision-ledger'
import { redactUrl } from '../security/secret-vault'
import { createSpiderAgent } from './agent'
import { buildSpiderPrompt } from './instructions'
import type { PhaseEvent, SolverStreamMessage } from '../solver/solver'
import type { IdentityContext, ReachabilityRecord, AuthTransition } from '../identity/types'
import {
  anonymousIdentity,
  createReachability,
  identityForAuthFlow,
  pushReachability,
  reachabilityKey,
} from '../identity/reachability'
import type { AuthFlowType } from '../types/shared'

export type ScopeClassification = 'allowed' | 'proposed' | 'denied'

export interface ObservedFormField {
  name: string
  type: string
  required: boolean
  label?: string
  placeholder?: string
  autocomplete?: string
  maxLength?: number
}

export interface ObservedForm {
  url: string
  selector?: string
  method?: string
  action?: string
  role?: string
  submitLabel?: string
  fields?: ObservedFormField[]
  identity?: IdentityContext
  provenanceId?: string
}
/**
 * Why the crawl ended. `agent_stopped` means the model stream ended while
 * actionable frontier items (allowed, within depth) remained — the frontier
 * was NOT exhausted; the driver simply quit. Kept distinct from
 * `frontier_exhausted` so coverage reporting never lies about exploration.
 */
export type SpiderStopReason = 'frontier_exhausted' | 'agent_stopped' | 'max_pages' | 'max_depth' | 'max_duration' | 'stale' | 'aborted' | 'error'
export type SpiderRuntimeEventName =
  | 'crawl_started'
  | 'page_seen'
  | 'endpoint_seen'
  | 'form_seen'
  | 'auth_detected'
  | 'auth_transition'
  | 'scope_proposed'
  | 'crawl_progress'
  | 'crawl_stalled'
  | 'crawl_completed'

export interface FrontierItem {
  url: string
  depth: number
  scope: ScopeClassification
  sourcePage?: string
  triggeringAction?: string
  /** The identity context that queued this URL (slice 06). */
  identity?: IdentityContext
}

export interface SpiderRuntimeState {
  workflowId: string
  target: string
  frontier: FrontierItem[]
  visitedUrls: string[]
  discoveredForms: ObservedForm[]
  endpoints: Array<{ method: string; url: string; params: string[]; scope: ScopeClassification; sourcePage?: string; identity?: IdentityContext; provenanceId?: string }>
  authStates: Array<{ url: string; state: string; role?: string }>
  /** Origins of discovered URLs classified `proposed` — surfaced for user approval. */
  proposedOrigins: string[]
  /** Reserved contract field (slice 06 — workflow discovery). No producer yet. */
  workflows: Array<{ name: string; entryUrl?: string; role?: string }>
  /** Reserved contract field. No producer yet. */
  assets: Array<{ url: string; type?: string; scope: ScopeClassification }>
  /** Slice 06 — the active identity context discoveries are attributed to. */
  currentIdentity: IdentityContext
  /** Slice 06 — typed auth transitions (anonymous → authenticated, role swap, logout). */
  authTransitions: AuthTransition[]
  /** Slice 06 — identity → resource reachability observations. */
  reachability: ReachabilityRecord[]
  stopReason?: SpiderStopReason
  /** A8 — typed bot-challenge observations at grounding/navigate time. */
  challengeSignals?: Array<{ vendor: string; signals: string[]; at: number }>
  startedAt: number
  updatedAt: number
  pagesSeen: number
  staleRounds: number
}

export interface SpiderRuntimeEvent {
  type: SpiderRuntimeEventName
  workflowId: string
  timestamp: number
  target?: string
  url?: string
  method?: string
  params?: string[]
  scope?: ScopeClassification
  provenanceId?: string
  pages?: number
  endpoints?: number
  forms?: number
  reason?: SpiderStopReason | string
  message?: string
  state?: SpiderRuntimeState
  /** Slice 06 — identity under which this event's resource was reached. */
  identity?: IdentityContext
  /** Slice 06 — auth transition payload (auth_transition events). */
  authTransition?: AuthTransition
  /** Slice 06 — auth transition origin/target identities (auth_transition events). */
  from?: IdentityContext
  to?: IdentityContext
  /** Target-provided HTML form structure; values are deliberately omitted. */
  form?: ObservedForm
}

export interface SpiderRuntimeOptions {
  workflowId: string
  target: string
  config: UltimatrixConfig
  initialState?: Partial<SpiderRuntimeState>
  /** Slice 06 — starting identity context (defaults to anonymous). */
  initialIdentity?: IdentityContext
  onEvent?: (event: SpiderRuntimeEvent) => void
  /** Explicit scope opt-out for this runtime. Undefined inherits the ambient global flag. */
  allowAny?: boolean
  /** Proposed origins pre-approved by the user (each run of the boundary). */
  approvedOrigins?: string[]
}

export class EngagementBoundary {
  readonly target: string
  readonly allowedOrigins: string[]
  readonly allowedCategories: AuthorizationCategory[]
  readonly externalToolsEnabled: boolean
  readonly proposedOrigins: string[] = []
  readonly approvedProposals: string[] = []
  private scopeConfig: ScopeConfig | null

  constructor(
    target: string,
    private config: UltimatrixConfig,
    private allowAny?: boolean,
    private workflowId?: string,
  ) {
    this.target = target
    this.scopeConfig = bindScopeToTarget(target, config.scope)
    this.allowedOrigins = this.scopeConfig?.allowedDomains ?? []
    this.allowedCategories = config.scope?.allowedCategories ?? []
    this.externalToolsEnabled = config.externalTools?.enabled === true
  }

  originOf(url: string): string {
    try {
      return new URL(url).origin
    } catch {
      return url
    }
  }

  /** Pure authorization check against THIS boundary's policy (never ambient state). */
  isActionAuthorized(category: AuthorizationCategory): boolean {
    return isCategoryAuthorized(category, {
      allowedCategories: this.allowedCategories,
      externalToolsEnabled: this.externalToolsEnabled,
    })
  }

  /**
   * Explicit user approval of a proposed URL/origin. Expands this boundary's
   * scope (so future classifications admit it) and the ambient transport gate
   * (so approved URLs actually execute). Idempotent per origin.
   */
  approveProposed(url: string): void {
    const origin = this.originOf(url)
    if (this.approvedProposals.includes(origin)) return
    this.approvedProposals.push(origin)
    const hostname = origin.startsWith('http') ? new URL(origin).hostname.toLowerCase() : origin.toLowerCase()
    if (this.scopeConfig) {
      const domains = this.scopeConfig.allowedDomains ?? (this.scopeConfig.allowedDomains = [])
      if (!domains.includes(hostname)) domains.push(hostname)
    }
    approveScopeOrigin(origin)
  }

  classifyUrl(url: string): { scope: ScopeClassification; reason?: string } {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { scope: 'denied', reason: 'invalid_url' }
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { scope: 'denied', reason: 'unsupported_protocol' }
    }

    const checked = isUrlInScope(url, this.scopeConfig, { allowAny: this.allowAny })
    if (checked.allowed) {
      getGlobalDecisionLedger().recordDecision({
        kind: 'scope.classify',
        reason: `classify ${redactUrl(url)} as allowed`,
        sourceRefs: this.workflowId ? [this.workflowId] : [],
      })
      return { scope: 'allowed' }
    }
    getGlobalDecisionLedger().recordDecision({
      kind: 'scope.classify',
      reason: `classify ${redactUrl(url)} as proposed`,
      routingReason: checked.reason,
      sourceRefs: this.workflowId ? [this.workflowId] : [],
    })
    return { scope: 'proposed', reason: checked.reason }
  }
}

export class SpiderRuntime {
  readonly boundary: EngagementBoundary
  private state: SpiderRuntimeState
  private seenPages = new Set<string>()
  private seenEndpoints = new Set<string>()
  private seenForms = new Set<string>()
  private seenAuthFlows = new Set<string>()
  private seenReachability = new Set<string>()
  private terminalSnapshot?: SpiderRuntimeState
  private terminalEventEmitted = false

  constructor(private opts: SpiderRuntimeOptions) {
    const now = Date.now()
    this.boundary = new EngagementBoundary(opts.target, opts.config, opts.allowAny, opts.workflowId)
    this.state = {
      workflowId: opts.workflowId,
      target: opts.target,
      frontier: opts.initialState?.frontier ?? [],
      visitedUrls: opts.initialState?.visitedUrls ?? [],
      discoveredForms: opts.initialState?.discoveredForms ?? [],
      endpoints: opts.initialState?.endpoints ?? [],
      authStates: opts.initialState?.authStates ?? [],
      proposedOrigins: opts.initialState?.proposedOrigins ?? [],
      workflows: opts.initialState?.workflows ?? [],
      assets: opts.initialState?.assets ?? [],
      currentIdentity: opts.initialState?.currentIdentity ?? opts.initialIdentity ?? anonymousIdentity(),
      authTransitions: opts.initialState?.authTransitions ?? [],
      reachability: opts.initialState?.reachability ?? [],
      stopReason: opts.initialState?.stopReason,
      startedAt: opts.initialState?.startedAt ?? now,
      updatedAt: now,
      pagesSeen: opts.initialState?.pagesSeen ?? 0,
      staleRounds: opts.initialState?.staleRounds ?? 0,
    }
    for (const url of this.state.visitedUrls) this.seenPages.add(url)
    for (const endpoint of this.state.endpoints) this.seenEndpoints.add(`${endpoint.method}:${endpoint.url}`)
    for (const form of this.state.discoveredForms) this.seenForms.add(`${form.url}:${form.selector ?? form.action ?? ''}`)
    for (const r of this.state.reachability) this.seenReachability.add(reachabilityKey(r))
    for (const origin of opts.approvedOrigins ?? []) {
      this.approveProposed(origin)
    }
  }

  snapshot(): SpiderRuntimeState {
    return this.copyState(this.state)
  }

  private copyState(state: SpiderRuntimeState): SpiderRuntimeState {
    return {
      ...state,
      frontier: [...state.frontier],
      visitedUrls: [...state.visitedUrls],
      discoveredForms: state.discoveredForms.map(form => ({
        ...form,
        ...(form.fields ? { fields: form.fields.map(field => ({ ...field })) } : {}),
      })),
      endpoints: [...state.endpoints],
      authStates: [...state.authStates],
      proposedOrigins: [...state.proposedOrigins],
      workflows: [...state.workflows],
      assets: [...state.assets],
      authTransitions: [...state.authTransitions],
      reachability: [...state.reachability],
      ...(state.challengeSignals ? { challengeSignals: [...state.challengeSignals] } : {}),
    }
  }

  start(): void {
    this.emit({ type: 'crawl_started', target: this.state.target, state: this.snapshot() })
  }

  enqueue(url: string, depth = 0, sourcePage?: string, triggeringAction?: string, identity: IdentityContext = this.state.currentIdentity): ScopeClassification {
    const { scope, reason } = this.boundary.classifyUrl(url)
    const canonical = canonicalCrawlUrl(url)
    const alreadyQueued = this.state.frontier.some((item) => canonicalCrawlUrl(item.url) === canonical)
    const alreadyVisited = [...this.seenPages].some((seen) => canonicalCrawlUrl(seen) === canonical)
    if (!alreadyQueued && !alreadyVisited) {
      this.state.frontier.push({ url, depth, scope, sourcePage, triggeringAction, identity })
    }
    if (scope === 'proposed') {
      const origin = this.boundary.originOf(url)
      if (!this.state.proposedOrigins.includes(origin)) this.state.proposedOrigins.push(origin)
      this.emit({ type: 'scope_proposed', url, scope, reason, state: this.snapshot() })
      emitScopeProposed(this.state.workflowId, url, reason)
    }
    this.touch()
    return scope
  }

  /**
   * Explicit user approval of a proposed URL/origin. Expands the boundary (so
   * future classifications admit it) and reclassifies already-discovered
   * proposed items from that origin as `allowed` (approval is a user decision —
   * the item is no longer awaiting consent).
   */
  approveProposed(url: string): void {
    this.boundary.approveProposed(url)
    const origin = this.boundary.originOf(url)
    if (!this.state.proposedOrigins.includes(origin)) this.state.proposedOrigins.push(origin)
    for (const item of this.state.frontier) {
      if (item.scope === 'proposed' && this.boundary.originOf(item.url) === origin) {
        item.scope = 'allowed'
      }
    }
    this.touch()
  }

  recordPage(url: string, status = 0, links = 0, forms = 0): void {
    const { scope } = this.boundary.classifyUrl(url)
    const identity = this.state.currentIdentity
    // A URL is queued before navigation so the driver has work to dequeue.
    // Once navigation grounds that URL, remove every matching frontier item;
    // otherwise the landing page remains perpetually actionable and a resumed
    // crawl can revisit/re-report the same page indefinitely.
    const canonical = canonicalCrawlUrl(url)
    this.state.frontier = this.state.frontier.filter((item) => canonicalCrawlUrl(item.url) !== canonical)
    const alreadyVisited = [...this.seenPages].some((seen) => canonicalCrawlUrl(seen) === canonical)
    if (!alreadyVisited) {
      this.seenPages.add(url)
      this.state.visitedUrls.push(url)
      this.state.pagesSeen++
    }
    this.recordReach('page', url)
    const provenanceId = getGlobalDecisionLedger().recordProvenance({
      source: 'web',
      pageUrl: url,
    }).id
    this.touch()
    this.emit({ type: 'page_seen', url, scope, identity, provenanceId, pages: this.state.pagesSeen, forms, state: this.snapshot() })
    emitSpiderPage(url, status, links, forms)
  }

  recordEndpoint(method: string, url: string, params: string[] = [], sourcePage?: string): void {
    const { scope } = this.boundary.classifyUrl(url)
    const identity = this.state.currentIdentity
    const key = `${method}:${url}`
    let provenanceId: string | undefined
    if (!this.seenEndpoints.has(key)) {
      this.seenEndpoints.add(key)
      provenanceId = getGlobalDecisionLedger().recordProvenance({
        source: 'web',
        pageUrl: url,
        actionId: `${method} ${url}`,
      }).id
      this.state.endpoints.push({ method, url, params, scope, sourcePage, identity, provenanceId })
    }
    this.recordReach('endpoint', url)
    this.touch()
    this.emit({ type: 'endpoint_seen', method, url, params, scope, identity, provenanceId, endpoints: this.state.endpoints.length, state: this.snapshot() })
    emitSpiderEndpoint(method, url, params)
  }

  recordForm(
    url: string,
    selector?: string,
    method?: string,
    action?: string,
    role?: string,
    details: { submitLabel?: string; fields?: ObservedFormField[] } = {},
  ): void {
    const key = `${url}:${selector ?? action ?? ''}`
    const identity = this.state.currentIdentity
    let provenanceId: string | undefined
    if (!this.seenForms.has(key)) {
      this.seenForms.add(key)
      provenanceId = getGlobalDecisionLedger().recordProvenance({
        source: 'web',
        pageUrl: url,
        actionId: selector ?? action,
      }).id
      this.state.discoveredForms.push({ url, selector, method, action, role, ...details, identity, provenanceId })
    } else {
      const existing = this.state.discoveredForms.find(form => `${form.url}:${form.selector ?? form.action ?? ''}` === key)
      if (existing) Object.assign(existing, { method, action, role, ...details, identity })
    }
    this.recordReach('form', url)
    this.touch()
    const form = this.state.discoveredForms.find(item => `${item.url}:${item.selector ?? item.action ?? ''}` === key)
    this.emit({ type: 'form_seen', url, method, identity, provenanceId, form: form ? { ...form } : undefined, forms: this.state.discoveredForms.length, state: this.snapshot() })
  }

  recordAuth(url: string, state: string, role?: string): void {
    this.state.authStates.push({ url, state, role })
    this.touch()
    this.emit({ type: 'auth_detected', url, message: state, state: this.snapshot() })
  }

  /**
   * Slice 06 — record a typed auth transition. Updates the active identity
   * context and emits an `auth_transition` event so downstream consumers (web
   * parity, role-aware reporting) see the identity change as a typed fact.
   * Same-identity calls are idempotent (no spurious transitions).
   */
  setIdentity(identity: IdentityContext, url?: string, sourceRef?: string): void {
    const from = this.state.currentIdentity
    if (from.id === identity.id && from.kind === identity.kind) return
    const transition: AuthTransition = {
      workflowId: this.state.workflowId,
      from,
      to: identity,
      ...(url ? { url } : {}),
      at: Date.now(),
      ...(sourceRef ? { sourceRef } : {}),
    }
    this.state.authTransitions.push(transition)
    this.state.currentIdentity = identity
    this.touch()
    this.emit({ type: 'auth_transition', url, from: transition.from, to: transition.to, authTransition: transition, state: this.snapshot() })
  }

  /**
   * Slice 06 — fold an observed AUTH_FLOW into the crawl identity. Auth-capable
   * flow types (typed enum) transition the active identity; flows that do not
   * change identity are ignored. Idempotent per flow node id.
   */
  recordAuthFlow(flowId: string, flowType: AuthFlowType, label?: string, url?: string): void {
    if (this.seenAuthFlows.has(flowId)) return
    this.seenAuthFlows.add(flowId)
    const identity = identityForAuthFlow(flowType, label ?? flowType, url)
    if (!identity || identity.id === this.state.currentIdentity.id) return
    this.setIdentity(identity, url, flowId)
  }

  /** Slice 06 — record a reachability observation (deduped per identity+resource). */
  private recordReach(resourceType: ReachabilityRecord['resourceType'], resourceId: string): void {
    const record = createReachability(this.state.workflowId, this.state.currentIdentity, resourceType, resourceId)
    const key = reachabilityKey(record)
    if (this.seenReachability.has(key)) return
    this.seenReachability.add(key)
    this.state.reachability = pushReachability(this.state.reachability, record)
  }

  /** A8 — record a typed bot-challenge observation (surfaced in state + events). */
  recordChallengeSignal(vendor: string, signals: string[]): void {
    this.state.challengeSignals = [...(this.state.challengeSignals ?? []), { vendor, signals, at: Date.now() }]
    this.touch()
  }

  recordProgress(useful: boolean, staleThreshold: number): SpiderStopReason | undefined {    this.state.staleRounds = useful ? 0 : this.state.staleRounds + 1
    this.touch()
    this.emit({
      type: 'crawl_progress',
      pages: this.state.pagesSeen,
      endpoints: this.state.endpoints.length,
      forms: this.state.discoveredForms.length,
      state: this.snapshot(),
    })
    if (this.state.staleRounds >= staleThreshold) {
      this.state.stopReason = 'stale'
      this.emit({ type: 'crawl_stalled', reason: 'stale', state: this.snapshot() })
      return 'stale'
    }
    return undefined
  }

  stop(reason: SpiderStopReason, emitCompletion = true): SpiderRuntimeState {
    if (this.terminalSnapshot) return this.copyState(this.terminalSnapshot)
    this.state.stopReason = reason
    this.touch()
    this.terminalSnapshot = this.snapshot()
    if (emitCompletion) this.emitCompletion()
    return this.copyState(this.terminalSnapshot)
  }

  emitCompletion(): void {
    if (!this.terminalSnapshot || this.terminalEventEmitted) return
    this.terminalEventEmitted = true
    this.emit({
      type: 'crawl_completed',
      reason: this.terminalSnapshot.stopReason!,
      state: this.copyState(this.terminalSnapshot),
    })
  }

  /**
   * Pop the next actionable frontier entry (FIFO, allowed scope only).
   * Dequeue is the honest traversal primitive: limits and stop reasons are
   * computed against what could still be visited, not what merely sat queued.
   */
  dequeue(): FrontierItem | null {
    const idx = this.state.frontier.findIndex((item) => item.scope === 'allowed')
    if (idx === -1) return null
    const [entry] = this.state.frontier.splice(idx, 1)
    this.touch()
    return entry
  }

  /** Count frontier items that could legitimately still be visited. */
  countActionable(maxDepth: number): number {
    return this.state.frontier.filter((item) => item.scope === 'allowed' && item.depth <= maxDepth).length
  }

  shouldStopByLimits(maxPages: number, maxDepth: number): SpiderStopReason | undefined {
    if (this.state.pagesSeen >= maxPages) return 'max_pages'
    if (this.countActionable(maxDepth) > 0) return undefined
    return this.state.frontier.length > 0 ? 'max_depth' : undefined
  }

  private touch(): void {
    this.state.updatedAt = Date.now()
  }

  private emit(event: Omit<SpiderRuntimeEvent, 'workflowId' | 'timestamp'>): void {
    const full: SpiderRuntimeEvent = { ...event, workflowId: this.state.workflowId, timestamp: Date.now() }
    this.opts.onEvent?.(full)
    getGlobalEmitter().emit('spider:event', full)
  }
}

export interface SpiderRunOptions {
  config: UltimatrixConfig
  target: string
  browser: any
  memory?: any
  threadId?: string
  resourceId?: string
  graphStore?: {
    queryNodes?: (type?: NodeType) => GraphNodeData[]
    save?: () => Promise<void>
    mergePage?: (url: string, data?: Record<string, unknown>) => unknown
    mergeEndpoint?: (data: Record<string, unknown> & { url: string; method: string }) => unknown
    addReachability?: (record: ReachabilityRecord & { identityKind?: string; roleName?: string; tenantId?: string }) => unknown
  }
  workflowId?: string
  initialState?: Partial<SpiderRuntimeState>
  onEvent?: (event: SpiderRuntimeEvent) => void
  onText?: (text: string) => void
  onMessage?: (msg: SolverStreamMessage) => void
  onPhase?: (event: PhaseEvent) => void
  signal?: AbortSignal
  /** Explicit scope opt-out for this run. Undefined inherits the ambient global flag. */
  allowAny?: boolean
  /** Proposed origins pre-approved by the user before this crawl starts. */
  approvedOrigins?: string[]
  /** Retains the live runtime handle (for mid-crawl approval / live state). */
  onRuntime?: (runtime: SpiderRuntime) => void
  onFinalize?: (state: SpiderRuntimeState, outcome: SpiderRunOutcome) => Promise<string | void>
}

export type SpiderRunOutcome =
  | { status: 'completed'; stopReason: Exclude<SpiderStopReason, 'aborted' | 'error'> }
  | { status: 'aborted'; reason: string }
  | { status: 'failed'; error: string }

export interface SpiderRunResult {
  state: SpiderRuntimeState
  outcome: SpiderRunOutcome
  checkpointId: string
}

export function createSpiderFinalizer(runtime: SpiderRuntime, options: SpiderRunOptions, startedAt: number) {
  let finalized: Promise<SpiderRunResult> | undefined
  return (reason: SpiderStopReason, error?: string): Promise<SpiderRunResult> => finalized ??= (async () => {
    const state = runtime.stop(reason, false)
    persistReachability(options.graphStore, state)
    const outcome: SpiderRunOutcome = reason === 'error'
      ? { status: 'failed', error: error ?? 'Spider failed' }
      : reason === 'aborted'
        ? { status: 'aborted', reason: 'Spider aborted' }
        : { status: 'completed', stopReason: reason }
    const checkpointId = await options.onFinalize?.(state, outcome)
    if (!options.onFinalize) await options.graphStore?.save?.()
    runtime.emitCompletion()
    if (outcome.status === 'completed') emitSpiderComplete(state.pagesSeen, state.endpoints.length, Date.now() - startedAt)
    return { state, outcome, checkpointId: checkpointId ?? `${state.workflowId}:${state.updatedAt}` }
  })()
}

export async function runSpiderRuntime(options: SpiderRunOptions): Promise<SpiderRunResult> {
  // C2 — text-only output coalesces into progress rounds at this granularity.
  const TEXT_ROUND_CHARS = 4000
  const { config, target, browser, memory, threadId, resourceId, graphStore } = options
  if (memory && (!threadId || !resourceId)) {
    throw new Error('Spider runtime requires threadId and resourceId when memory is enabled')
  }
  const maxPages = config.spider?.maxPages ?? config.spider?.maxSteps ?? DEFAULTS.spider.maxPages
  const maxDepth = config.spider?.maxDepth ?? DEFAULTS.spider.maxDepth
  const maxDurationMs = config.spider?.maxDurationMs ?? DEFAULTS.spider.maxDurationMs
  const staleThreshold = config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold
  const runtime = new SpiderRuntime({
    workflowId: options.workflowId ?? `workflow-${stableTargetId(target)}`,
    target,
    config,
    initialState: options.initialState,
    onEvent: options.onEvent,
    allowAny: options.allowAny,
    approvedOrigins: options.approvedOrigins,
  })
  // Rehydrate the typed spider state from the engagement graph before the
  // model sees the target. HAR/passive discovery may have found endpoints in
  // an earlier phase even when the spider checkpoint is empty; keeping those
  // surfaces only in graph memory makes the agent rediscover them repeatedly.
  hydrateRuntimeFromGraph(runtime, graphStore, target)
  options.onRuntime?.(runtime)
  const startedAt = Date.now()
  const deadline = startedAt + maxDurationMs
  const deadlineController = new AbortController()
  const deadlineTimer = setTimeout(() => deadlineController.abort(), maxDurationMs)
  if (typeof deadlineTimer === 'object' && 'unref' in deadlineTimer) deadlineTimer.unref()
  if (options.signal) {
    if (options.signal.aborted) deadlineController.abort()
    else options.signal.addEventListener('abort', () => deadlineController.abort(), { once: true })
  }
  const finalize = createSpiderFinalizer(runtime, options, startedAt)

  runtime.start()
  runtime.enqueue(target, 0)
  emitSpiderStart(target, maxPages, maxDurationMs)

  try {
    await groundLandingPage(runtime, options, browser, deadlineController.signal, deadline - Date.now())
  } catch (err) {
    if (deadlineController.signal.aborted) {
      return finalize(options.signal?.aborted ? 'aborted' : 'max_duration')
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error(message)
    emitSpiderError(target, message)
    return finalize('error', message)
  }

  let counts = collectGraphState(graphStore)
  let stopReason: SpiderStopReason | undefined

  try {
    const spiderAgent = createSpiderAgent(config, memory, browser)
    const streamPrompt = buildSpiderPrompt(target)
    const result = await Promise.race([
      spiderAgent.stream(streamPrompt, {
        memory: memory ? { thread: `${threadId}-spider`, resource: `${resourceId}-spider` } : undefined,
        maxSteps: config.spider?.maxSteps ?? config.agent.maxSteps,
        abortSignal: deadlineController.signal,
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error(`Spider stream init timed out after ${maxDurationMs}ms`)), maxDurationMs)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      }),
    ])

    const stream = (result as any).fullStream ?? textStreamAsChunks((result as any).textStream)
    // C2 — stale accounting on every model round, not only tool results.
    // A model that streams text without calling tools still consumes budget;
    // coalesce its deltas into rounds (per TEXT_ROUND_CHARS) so staleness
    // accrues there too. Tool results remain one round each.
    let pendingTextChars = 0
    for await (const chunk of stream) {
      if (options.signal?.aborted) {
        stopReason = 'aborted'
        break
      }
      if (Date.now() > deadline) {
        stopReason = 'max_duration'
        break
      }

      stopReason = consumeSpiderChunk(chunk, runtime, options)
      if (stopReason) break

      if (chunk?.type === 'tool-result') {
        pendingTextChars = 0
        try {
          await recordPageFormSurfaces(runtime, graphStore, getStagehandPage(browser))
        } catch { /* page inspection is passive and must not fail the crawl */ }
        const nextCounts = collectGraphState(graphStore)
        ingestGraphDiff(runtime, counts, nextCounts)
        const useful = nextCounts.endpoints.size > counts.endpoints.size || nextCounts.pages.size > counts.pages.size || nextCounts.forms.size > counts.forms.size
        counts = nextCounts
        stopReason = runtime.recordProgress(useful, staleThreshold)
        if (stopReason) break
      } else if (chunk?.type === 'text-delta') {
        pendingTextChars += String(chunk.payload?.text ?? '').length
        if (pendingTextChars >= TEXT_ROUND_CHARS) {
          pendingTextChars = 0
          const nextCounts = collectGraphState(graphStore)
          ingestGraphDiff(runtime, counts, nextCounts)
          const useful = nextCounts.endpoints.size > counts.endpoints.size || nextCounts.pages.size > counts.pages.size || nextCounts.forms.size > counts.forms.size
          counts = nextCounts
          stopReason = runtime.recordProgress(useful, staleThreshold)
          if (stopReason) break
        }
      }

      stopReason = runtime.shouldStopByLimits(maxPages, maxDepth)
      if (stopReason) break
    }

    // A model is allowed to end a stream, but it is not allowed to turn an
    // unfinished frontier into a successful crawl. Give it one bounded,
    // explicit continuation turn before recording agent_stopped. This keeps
    // autonomy while preserving the honest terminal reason when the retry also
    // declines to act.
    if (stopReason === 'agent_stopped' && runtime.countActionable(maxDepth) > 0 && Date.now() < deadline) {
      stopReason = undefined
      const continuation = await spiderAgent.stream(
        `${streamPrompt} Continue from the current checkpoint. The crawl is incomplete: actionable frontier items remain. Perform browser actions and graph recording now; do not return a summary until the frontier is exhausted or a genuine approval blocker is reached.`,
        {
          memory: memory ? { thread: `${threadId}-spider`, resource: `${resourceId}-spider` } : undefined,
          maxSteps: config.spider?.maxSteps ?? config.agent.maxSteps,
          abortSignal: deadlineController.signal,
        },
      )
      const continuationStream = (continuation as any).fullStream ?? textStreamAsChunks((continuation as any).textStream)
      for await (const chunk of continuationStream) {
        if (options.signal?.aborted || Date.now() > deadline) break
        stopReason = consumeSpiderChunk(chunk, runtime, options)
        if (chunk?.type === 'tool-result') {
          try {
            await recordPageFormSurfaces(runtime, graphStore, getStagehandPage(browser))
          } catch { /* page inspection is passive and must not fail the crawl */ }
          const nextCounts = collectGraphState(graphStore)
          ingestGraphDiff(runtime, counts, nextCounts)
          counts = nextCounts
        }
        if (stopReason) break
      }
    }

    const finalCounts = collectGraphState(graphStore)
    ingestGraphDiff(runtime, counts, finalCounts)

    // C1 — honest terminal reason: `frontier_exhausted` only when nothing
    // actionable remains; if allowed in-depth items are still queued, the
    // agent driver quit early and that is reported as `agent_stopped`.
    if (runtime.countActionable(maxDepth) > 0) {
      stopReason ??= 'agent_stopped'
    } else {
      stopReason ??= 'frontier_exhausted'
    }
    if (runtime.snapshot().pagesSeen === 0 && finalCounts.pages.size === 0) {
      return finalize('error', 'Target grounding failed: no page was observed after browser navigation')
    }
    return finalize(stopReason)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (deadlineController.signal.aborted || Date.now() >= deadline) {
      return finalize(options.signal?.aborted ? 'aborted' : 'max_duration')
    }
    log.error(message)
    emitSpiderError(target, message)
    return finalize('error', message)
  } finally {
    clearTimeout(deadlineTimer)
  }
}

async function groundLandingPage(
  runtime: SpiderRuntime,
  options: SpiderRunOptions,
  browser: unknown,
  signal: AbortSignal,
  remainingMs: number,
): Promise<void> {
  const page = getStagehandPage(browser)
  let finalUrl: string
  let status = 0

  if (page?.goto) {
    enforceAction('browser_action', { toolId: 'spider.groundLandingPage' })
    const release = await getTargetTransportGovernor().acquire(options.target, 'default', signal)
    let response: any
    try {
      response = await runNavigationWithAbort(() => page.goto(options.target, {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(1, Math.min(options.config.timeout ?? DEFAULTS.timeout, remainingMs)),
      }), page, signal)
    } finally {
      release()
    }
    finalUrl = typeof page.url === 'function' ? page.url() : options.target
    status = typeof response?.status === 'function' ? response.status() : 0
  } else {
    const tools = typeof (browser as any)?.getTools === 'function' ? (browser as any).getTools() : {}
    const navigate = tools?.stagehand_navigate
    if (typeof navigate?.execute !== 'function') {
      throw new Error('Target grounding failed: browser has no page.goto or stagehand_navigate tool')
    }
    enforceAction('browser_action', { toolId: 'spider.groundLandingPage' })
    const result: any = await runNavigationWithAbort(() => navigate.execute({ url: options.target }, { page }), page, signal)
    if (result?.success === false) throw new Error(String(result.error ?? 'stagehand_navigate failed'))
    finalUrl = String(result?.url ?? options.target)
  }

  const title = await safePageTitle(page)
  const links = await readLinks(page, finalUrl)
  const forms = await readForms(page, finalUrl)

  // A8 — challenge detection at grounding: if the landing page is a bot
  // challenge, grounding cannot produce real surface data. Surface a typed
  // signal so the run degrades honestly instead of recording a fake page.
  try {
    const { getGlobalBotHandler } = await import('../browser/anti-bot')
    const handler = getGlobalBotHandler()
    const status = typeof page?.goto === 'function' ? 0 : 0
    void status
    const challenge = await handler.detectChallenge(page)
    if (challenge.detected) {
      runtime.recordChallengeSignal(challenge.vendor, challenge.signals.map(s => `${s.kind}:${s.detail.slice(0, 60)}`))
      throw new Error(
        `Bot challenge detected at landing (${challenge.vendor}/${challenge.challengeType}). ` +
        `Crawl cannot proceed through the browser. Signals: ${challenge.signals.map(s => s.kind).join(',')}`,
      )
    }
  } catch (err) {
    // Re-throw only genuine challenge failures; detector unavailability is non-fatal.
    if (err instanceof Error && err.message.startsWith('Bot challenge detected')) throw err
  }

  options.graphStore?.mergePage?.(finalUrl, {
    title,
    contentType: 'text/html',
    contentLength: 0,
    timestamp: Date.now(),
    tags: ['baseline-grounding'],
  })
  runtime.recordPage(finalUrl, status, links.length, forms.length)
  // C3 — endpoint hygiene: plain navigation links are queued for traversal
  // only; they are NOT endpoints. A link becomes an Endpoint node when it
  // carries a query string (param-bearing request surface). This keeps
  // campaign matrices and coverage stats free of nav/footer/social noise.
  for (const link of links.slice(0, 100)) {
    runtime.enqueue(link, 1, finalUrl, 'baseline-link')
    const params = linkQueryParams(link)
    if (params.length > 0) {
      runtime.recordEndpoint('GET', link, params, finalUrl)
      options.graphStore?.mergeEndpoint?.({
        method: 'GET',
        url: link,
        params: params.map((name) => ({ name })),
        source: 'baseline-grounding',
        tags: ['baseline-link', 'param-bearing'],
      })
    }
  }
  for (const form of forms.slice(0, 50)) {
    recordFormSurface(runtime, options.graphStore, finalUrl, form)
  }
}

async function runNavigationWithAbort<T>(operation: () => Promise<T>, page: any, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const navigation = Promise.resolve().then(operation)
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Spider navigation aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  try {
    return await Promise.race([navigation, aborted])
  } catch (error) {
    if (signal.aborted) await stopPageNavigation(page)
    throw error
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function stopPageNavigation(page: any): Promise<void> {
  const stop = typeof page?.mainSession?.send === 'function'
    ? () => page.mainSession.send('Page.stopLoading')
    : typeof page?.evaluate === 'function'
      ? () => page.evaluate(() => window.stop())
      : undefined
  if (!stop) return
  await Promise.race([
    Promise.resolve().then(stop).catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ])
}

/** Query-parameter names of a URL (empty when the link has no query string). */
function linkQueryParams(link: string): string[] {
  try {
    return [...new URL(link).searchParams.keys()]
  } catch {
    return []
  }
}

function getStagehandPage(browser: unknown): any {
  try {
    // Phase A — provider handles expose their Playwright page directly.
    if (browser && typeof browser === 'object' && (browser as any).providerName === 'camofox') {
      return (browser as any).page ?? null
    }
    const stagehand = (browser as any)?.requireStagehand?.()
    const context = stagehand?.context
    if (!context) return null
    if (typeof context.activePage === 'function') return context.activePage()
    const pages = typeof context.pages === 'function' ? context.pages() : context.pages
    return Array.isArray(pages) ? pages[0] : null
  } catch {
    return null
  }
}

async function safePageTitle(page: any): Promise<string | undefined> {
  try {
    return typeof page?.title === 'function' ? await page.title() : undefined
  } catch {
    return undefined
  }
}

async function readLinks(page: any, baseUrl: string): Promise<string[]> {
  try {
    // Stagehand v3 and Playwright both expose evaluate; Stagehand does not
    // implement Playwright's $$eval API.
    if (typeof page?.evaluate !== 'function') return []
    const allHrefs: string[] = await page.evaluate(extractLinksInPage)
    // Framework routers often render route targets without a real anchor.
    // Read only URL-shaped attributes here; arbitrary button labels remain
    // Stagehand's semantic-action responsibility and are not guessed.
    return [...new Set(allHrefs.map((href: string) => {
      try { return new URL(href, baseUrl).toString() } catch { return '' }
    }).filter(Boolean))]
  } catch {
    return []
  }
}

async function readForms(page: any, baseUrl: string): Promise<Array<{
  selector: string
  method: string
  action?: string
  submitLabel?: string
  fields: ObservedFormField[]
}>> {
  try {
    if (typeof page?.evaluate !== 'function') return []
    return await page.evaluate(extractFormsInPage, baseUrl)
  } catch {
    return []
  }
}

/** Self-contained page callbacks so they also work with Stagehand's CDP Page. */
function extractLinksInPage(): string[] {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .map(el => el.href || el.getAttribute('href') || '')
  const routerLinks = Array.from(document.querySelectorAll<HTMLElement>('[routerlink],[routerLink],[data-route],[data-href]'))
    .flatMap(el => [el.getAttribute('routerlink'), el.getAttribute('routerLink'), el.getAttribute('data-route'), el.getAttribute('data-href')])
    .filter((value): value is string => Boolean(value))
  return [...anchors, ...routerLinks]
}

function extractFormsInPage(base: string): Array<{
  selector: string
  method: string
  action?: string
  submitLabel?: string
  fields: ObservedFormField[]
}> {
  return Array.from(document.querySelectorAll<HTMLFormElement>('form')).map((form, index) => {
    const rawAction = form.getAttribute('action') || base
    let action = rawAction
    try { action = new URL(rawAction, base).toString() } catch {}
    const compact = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
    const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name],select[name],textarea[name]'))
      .filter(field => !(['submit', 'button', 'reset', 'image', 'file'].includes((field as HTMLInputElement).type)))
      .slice(0, 100)
      .map(field => {
        const input = field as HTMLInputElement
        const labels = 'labels' in field ? Array.from(field.labels ?? []).map(label => label.textContent ?? '').join(' ') : ''
        const type = field.tagName.toLowerCase() === 'select'
          ? 'select'
          : field.tagName.toLowerCase() === 'textarea'
            ? 'textarea'
            : input.type || 'text'
        return {
          name: compact(field.name, 128),
          type: compact(type, 32),
          required: field.required,
          ...(compact(labels || field.getAttribute('aria-label'), 100) ? { label: compact(labels || field.getAttribute('aria-label'), 100) } : {}),
          ...(compact(field.getAttribute('placeholder'), 100) ? { placeholder: compact(field.getAttribute('placeholder'), 100) } : {}),
          ...(compact(field.getAttribute('autocomplete'), 64) ? { autocomplete: compact(field.getAttribute('autocomplete'), 64) } : {}),
          ...(Number.isFinite(input.maxLength) && input.maxLength > 0 ? { maxLength: input.maxLength } : {}),
        }
      })
      .filter(field => field.name.length > 0)
    const submit = form.querySelector<HTMLElement>('button[type="submit"],input[type="submit"],button:not([type])')
    const submitLabel = compact(submit?.textContent || submit?.getAttribute('value') || submit?.getAttribute('aria-label'), 100)
    return {
      selector: form.id ? `form#${form.id}` : `form:nth-of-type(${index + 1})`,
      method: (form.getAttribute('method') || 'GET').toUpperCase(),
      action,
      ...(submitLabel ? { submitLabel } : {}),
      fields,
    }
  })
}

async function recordPageFormSurfaces(runtime: SpiderRuntime, graphStore: SpiderRunOptions['graphStore'], page: any): Promise<void> {
  if (!page || typeof page.url !== 'function') return
  const pageUrl = String(page.url())
  const forms = await readForms(page, pageUrl)
  for (const form of forms.slice(0, 50)) recordFormSurface(runtime, graphStore, pageUrl, form)
}

function recordFormSurface(
  runtime: SpiderRuntime,
  graphStore: SpiderRunOptions['graphStore'],
  pageUrl: string,
  form: { selector: string; method: string; action?: string; submitLabel?: string; fields: ObservedFormField[] },
): void {
  let action: URL
  try { action = new URL(form.action || pageUrl, pageUrl) } catch { return }
  const method = form.method.toUpperCase()
  const formUrl = redactUrl(pageUrl)
  const formAction = redactUrl(`${action.origin}${action.pathname}`)
  const fields = form.fields.map(field => ({
    name: field.name.slice(0, 128),
    type: field.type.slice(0, 32),
    required: field.required === true,
    ...(field.label ? { label: field.label.slice(0, 100) } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder.slice(0, 100) } : {}),
    ...(field.autocomplete ? { autocomplete: field.autocomplete.slice(0, 64) } : {}),
    ...(Number.isFinite(field.maxLength) && (field.maxLength ?? 0) > 0 ? { maxLength: field.maxLength } : {}),
  })).filter(field => field.name.length > 0)
  const details = {
    ...(form.submitLabel ? { submitLabel: form.submitLabel } : {}),
    fields,
  }
  runtime.recordForm(formUrl, form.selector, method, formAction, undefined, details)

  if (method !== 'GET' && method !== 'POST') return
  if (runtime.boundary.classifyUrl(formAction).scope !== 'allowed') return

  const queryNames = [...action.searchParams.keys()]
  const params = [
    ...queryNames.map(name => ({ name, type: 'string', in: 'query' })),
    ...fields.map(field => ({
      name: field.name,
      type: field.type,
      in: method === 'GET' ? 'query' : 'body',
      required: field.required,
    })),
  ]
  runtime.recordEndpoint(method, formAction, params.map(param => param.name), formUrl)
  graphStore?.mergeEndpoint?.({
    method,
    url: formAction,
    params,
    source: 'browser-form',
    tags: ['html-form', 'target-provided'],
    description: 'Target-provided HTML form; field values were not stored.',
    origin: 'target',
  })
}

/** Slice 06 — fold the crawl's reachability observations into the graph. */
function persistReachability(
  graphStore: SpiderRunOptions['graphStore'],
  state: SpiderRuntimeState,
): void {
  for (const record of state.reachability) {
    graphStore?.addReachability?.({
      ...record,
      identityKind: record.identity.kind,
      roleName: record.identity.roleName,
      tenantId: record.identity.tenantId,
    })
  }
}

function consumeSpiderChunk(chunk: any, runtime: SpiderRuntime, options: SpiderRunOptions): SpiderStopReason | undefined {
  switch (chunk?.type) {
    case 'text-delta':
    case 'reasoning-delta':
      options.onText?.(chunk.payload.text)
      if (chunk.type === 'reasoning-delta') {
        options.onMessage?.({ kind: 'reasoning', text: chunk.payload.text, index: Date.now() })
      } else {
        options.onMessage?.({ kind: 'answer', text: chunk.payload.text, index: Date.now() })
      }
      return undefined
    case 'tool-call':
      options.onMessage?.({ kind: 'tool', name: chunk.payload.toolName, args: chunk.payload.args })
      options.onPhase?.({ phase: 'observe', step: 0, toolName: chunk.payload.toolName, toolArgs: chunk.payload.args })
      return undefined
    case 'tool-result':
      options.onMessage?.({ kind: 'tool-result', name: chunk.payload.toolName, ok: true, result: summarizeToolResult(chunk.payload.result) })
      options.onPhase?.({ phase: 'observe', step: 0, toolName: chunk.payload.toolName, toolResult: chunk.payload.result })
      return undefined
    case 'tool-error':
      options.onMessage?.({ kind: 'tool-result', name: chunk.payload.toolName, ok: false, result: String(chunk.payload.error) })
      return undefined
    default:
      if (typeof chunk === 'string') {
        options.onText?.(chunk)
        options.onMessage?.({ kind: 'answer', text: chunk, index: Date.now() })
      }
      return undefined
  }
}

async function* textStreamAsChunks(stream: AsyncIterable<string> | undefined): AsyncIterable<any> {
  if (!stream) return
  for await (const text of stream) yield { type: 'text-delta', payload: { text } }
}

function collectGraphState(graphStore: SpiderRunOptions['graphStore']) {
  const pages = new Map<string, GraphNodeData>()
  const endpoints = new Map<string, GraphNodeData>()
  const forms = new Map<string, GraphNodeData>()
  const authFlows = new Map<string, GraphNodeData>()
  for (const page of graphStore?.queryNodes?.(NodeType.PAGE) ?? []) pages.set(String(page.properties.url ?? page.id), page)
  for (const endpoint of graphStore?.queryNodes?.(NodeType.ENDPOINT) ?? []) {
    endpoints.set(`${endpoint.properties.method ?? 'GET'}:${endpoint.properties.url ?? endpoint.id}`, endpoint)
  }
  for (const form of graphStore?.queryNodes?.(NodeType.INPUT) ?? []) forms.set(`${form.properties.url ?? ''}:${form.properties.selector ?? form.id}`, form)
  for (const flow of graphStore?.queryNodes?.(NodeType.AUTH_FLOW) ?? []) authFlows.set(flow.id, flow)
  return { pages, endpoints, forms, authFlows }
}

function hydrateRuntimeFromGraph(
  runtime: SpiderRuntime,
  graphStore: SpiderRunOptions['graphStore'],
  target: string,
): void {
  let origin: string
  try { origin = new URL(target).origin } catch { return }
  const state = collectGraphState(graphStore)
  for (const node of state.pages.values()) {
    const url = String(node.properties.url ?? '')
    if (!url.startsWith(origin)) continue
    runtime.recordPage(url, Number(node.properties.status ?? 0))
  }
  for (const node of state.endpoints.values()) {
    const url = String(node.properties.url ?? '')
    if (!url.startsWith(origin)) continue
    const params = Array.isArray(node.properties.params)
      ? (node.properties.params as Array<{ name?: string }>).map((p) => String(p.name ?? '')).filter(Boolean)
      : []
    runtime.recordEndpoint(String(node.properties.method ?? 'GET'), url, params)
  }
}

function ingestGraphDiff(runtime: SpiderRuntime, before: ReturnType<typeof collectGraphState>, after: ReturnType<typeof collectGraphState>): void {
  for (const [url, node] of after.pages) {
    if (before.pages.has(url)) continue
    runtime.recordPage(String(node.properties.url ?? url), Number(node.properties.status ?? 0))
  }
  for (const [key, node] of after.endpoints) {
    if (before.endpoints.has(key)) continue
    const params = Array.isArray(node.properties.params)
      ? (node.properties.params as Array<{ name?: string }>).map((p) => String(p.name ?? '')).filter(Boolean)
      : []
    runtime.recordEndpoint(String(node.properties.method ?? 'GET'), String(node.properties.url ?? key), params)
  }
  for (const [key, node] of after.forms) {
    if (before.forms.has(key)) continue
    runtime.recordForm(String(node.properties.url ?? ''), String(node.properties.selector ?? key), String(node.properties.method ?? 'GET'))
  }
  // Slice 06 — auth flows are identity transitions: fold new AUTH_FLOW nodes
  // into the active identity context (typed flowType → typed identity kind).
  for (const [id, node] of after.authFlows) {
    if (before.authFlows.has(id)) continue
    runtime.recordAuthFlow(
      id,
      String(node.properties.flowType ?? '') as AuthFlowType,
      typeof node.properties.name === 'string' ? node.properties.name : undefined,
      String(node.properties.startUrl ?? node.properties.target ?? '') || undefined,
    )
  }
}

function summarizeToolResult(result: unknown): string {
  if (typeof result === 'string') return result.slice(0, 500)
  try {
    return JSON.stringify(result).slice(0, 500)
  } catch {
    return String(result).slice(0, 500)
  }
}

export function stableTargetId(target: string): string {
  return target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'target'
}

/** Normalize browser redirects/fragments for crawl identity and deduplication. */
function canonicalCrawlUrl(value: string): string {
  try {
    const url = new URL(value)
    // A bare hash (or the SPA root hash) is only a redirect artifact. Keep
    // meaningful hash-router paths distinct so /#/login and /#/admin are
    // independently crawlable.
    if (url.hash === '#' || url.hash === '#/') url.hash = ''
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    const normalized = value.replace(/\/+$/, '')
    return normalized === '#' || normalized.endsWith('/#') || normalized.endsWith('#/')
      ? normalized.replace(/#\/?$/, '')
      : normalized
  }
}
