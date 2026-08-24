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
import { deriveScopeFromTarget, isUrlInScope, isCategoryAuthorized, approveScopeOrigin } from '../safety/scope-guard'
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
import { z } from 'zod'

export type ScopeClassification = 'allowed' | 'proposed' | 'denied'
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
  discoveredForms: Array<{ url: string; selector?: string; method?: string; action?: string; role?: string; identity?: IdentityContext; provenanceId?: string }>
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
    this.scopeConfig = config.scope ?? deriveScopeFromTarget(target)
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
      discoveredForms: [...state.discoveredForms],
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
    const alreadyQueued = this.state.frontier.some((item) => item.url === url)
    if (!alreadyQueued && !this.seenPages.has(url)) {
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
    if (!this.seenPages.has(url)) {
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

  recordForm(url: string, selector?: string, method?: string, action?: string, role?: string): void {
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
      this.state.discoveredForms.push({ url, selector, method, action, role, identity, provenanceId })
    }
    this.recordReach('form', url)
    this.touch()
    this.emit({ type: 'form_seen', url, method, identity, provenanceId, forms: this.state.discoveredForms.length, state: this.snapshot() })
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
  options.onRuntime?.(runtime)
  const startedAt = Date.now()
  const deadline = startedAt + maxDurationMs
  const finalize = createSpiderFinalizer(runtime, options, startedAt)

  runtime.start()
  runtime.enqueue(target, 0)
  emitSpiderStart(target, maxPages, maxDurationMs)

  try {
    await groundLandingPage(runtime, options, browser)
  } catch (err) {
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
        structuredOutput: { schema: z.any() },
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
    log.error(message)
    emitSpiderError(target, message)
    return finalize('error', message)
  }
}

async function groundLandingPage(runtime: SpiderRuntime, options: SpiderRunOptions, browser: unknown): Promise<void> {
  const page = getStagehandPage(browser)
  let finalUrl: string
  let status = 0

  if (page?.goto) {
    const response = await page.goto(options.target, {
      waitUntil: 'domcontentloaded',
      timeout: options.config.timeout ?? DEFAULTS.timeout,
    })
    finalUrl = typeof page.url === 'function' ? page.url() : options.target
    status = typeof response?.status === 'function' ? response.status() : 0
  } else {
    const tools = typeof (browser as any)?.getTools === 'function' ? (browser as any).getTools() : {}
    const navigate = tools?.stagehand_navigate
    if (typeof navigate?.execute !== 'function') {
      throw new Error('Target grounding failed: browser has no page.goto or stagehand_navigate tool')
    }
    const result = await navigate.execute({ url: options.target }, { page })
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
    runtime.recordForm(finalUrl, form.selector, form.method, form.action)
  }
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
    const hrefs: string[] = typeof page?.$$eval === 'function'
      ? await page.$$eval('a[href]', (els: Element[]) => els.map((el) => (el as HTMLAnchorElement).href || el.getAttribute('href') || ''))
      : []
    return [...new Set(hrefs.map((href: string) => {
      try { return new URL(href, baseUrl).toString() } catch { return '' }
    }).filter(Boolean))]
  } catch {
    return []
  }
}

async function readForms(page: any, baseUrl: string): Promise<Array<{ selector: string; method: string; action?: string }>> {
  try {
    if (typeof page?.$$eval !== 'function') return []
    return await page.$$eval('form', (els: Element[], base: string) => els.map((el, index) => {
      const form = el as HTMLFormElement
      const rawAction = form.getAttribute('action') || base
      let action = rawAction
      try { action = new URL(rawAction, base).toString() } catch {}
      return {
        selector: form.id ? `form#${form.id}` : `form:nth-of-type(${index + 1})`,
        method: (form.getAttribute('method') || 'GET').toUpperCase(),
        action,
      }
    }), baseUrl)
  } catch {
    return []
  }
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
