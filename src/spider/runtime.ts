import type { UltimatrixConfig } from '../config'
import { DEFAULTS } from '../config'
import { NodeType, type GraphNodeData } from '../graph/schema'
import { getGlobalEmitter } from '../events/emitter'
import {
  emitSpiderComplete,
  emitSpiderEndpoint,
  emitSpiderError,
  emitSpiderPage,
  emitSpiderStart,
} from '../events/emitter'
import { deriveScopeFromTarget, isUrlInScope } from '../safety/scope-guard'
import { log } from '../utils/logger'
import { createSpiderAgent } from './agent'
import { buildSpiderPrompt } from './instructions'
import type { PhaseEvent, SolverStreamMessage } from '../solver/solver'

export type ScopeClassification = 'allowed' | 'proposed' | 'denied'
export type SpiderStopReason = 'frontier_exhausted' | 'max_pages' | 'max_depth' | 'max_duration' | 'stale' | 'aborted' | 'error'
export type SpiderRuntimeEventName =
  | 'crawl_started'
  | 'page_seen'
  | 'endpoint_seen'
  | 'form_seen'
  | 'auth_detected'
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
}

export interface SpiderRuntimeState {
  workflowId: string
  target: string
  frontier: FrontierItem[]
  visitedUrls: string[]
  discoveredForms: Array<{ url: string; selector?: string; method?: string; action?: string; role?: string }>
  endpoints: Array<{ method: string; url: string; params: string[]; scope: ScopeClassification; sourcePage?: string }>
  authStates: Array<{ url: string; state: string; role?: string }>
  workflows: Array<{ name: string; entryUrl?: string; role?: string }>
  assets: Array<{ url: string; type?: string; scope: ScopeClassification }>
  stopReason?: SpiderStopReason
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
  pages?: number
  endpoints?: number
  forms?: number
  reason?: SpiderStopReason | string
  message?: string
  state?: SpiderRuntimeState
}

export interface SpiderRuntimeOptions {
  workflowId: string
  target: string
  config: UltimatrixConfig
  initialState?: Partial<SpiderRuntimeState>
  onEvent?: (event: SpiderRuntimeEvent) => void
}

export class EngagementBoundary {
  constructor(private target: string, private config: UltimatrixConfig) {}

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

    const scopeConfig = this.config.scope ?? deriveScopeFromTarget(this.target)
    const checked = isUrlInScope(url, scopeConfig)
    if (checked.allowed) return { scope: 'allowed' }
    return { scope: 'proposed', reason: checked.reason }
  }
}

export class SpiderRuntime {
  readonly boundary: EngagementBoundary
  private state: SpiderRuntimeState
  private seenPages = new Set<string>()
  private seenEndpoints = new Set<string>()
  private seenForms = new Set<string>()

  constructor(private opts: SpiderRuntimeOptions) {
    const now = Date.now()
    this.boundary = new EngagementBoundary(opts.target, opts.config)
    this.state = {
      workflowId: opts.workflowId,
      target: opts.target,
      frontier: opts.initialState?.frontier ?? [],
      visitedUrls: opts.initialState?.visitedUrls ?? [],
      discoveredForms: opts.initialState?.discoveredForms ?? [],
      endpoints: opts.initialState?.endpoints ?? [],
      authStates: opts.initialState?.authStates ?? [],
      workflows: opts.initialState?.workflows ?? [],
      assets: opts.initialState?.assets ?? [],
      stopReason: opts.initialState?.stopReason,
      startedAt: opts.initialState?.startedAt ?? now,
      updatedAt: now,
      pagesSeen: opts.initialState?.pagesSeen ?? 0,
      staleRounds: opts.initialState?.staleRounds ?? 0,
    }
    for (const url of this.state.visitedUrls) this.seenPages.add(url)
    for (const endpoint of this.state.endpoints) this.seenEndpoints.add(`${endpoint.method}:${endpoint.url}`)
    for (const form of this.state.discoveredForms) this.seenForms.add(`${form.url}:${form.selector ?? form.action ?? ''}`)
  }

  snapshot(): SpiderRuntimeState {
    return {
      ...this.state,
      frontier: [...this.state.frontier],
      visitedUrls: [...this.state.visitedUrls],
      discoveredForms: [...this.state.discoveredForms],
      endpoints: [...this.state.endpoints],
      authStates: [...this.state.authStates],
      workflows: [...this.state.workflows],
      assets: [...this.state.assets],
    }
  }

  start(): void {
    this.emit({ type: 'crawl_started', target: this.state.target, state: this.snapshot() })
  }

  enqueue(url: string, depth = 0, sourcePage?: string, triggeringAction?: string): ScopeClassification {
    const { scope } = this.boundary.classifyUrl(url)
    const alreadyQueued = this.state.frontier.some((item) => item.url === url)
    if (!alreadyQueued && !this.seenPages.has(url)) {
      this.state.frontier.push({ url, depth, scope, sourcePage, triggeringAction })
    }
    if (scope === 'proposed') this.emit({ type: 'scope_proposed', url, scope, state: this.snapshot() })
    this.touch()
    return scope
  }

  recordPage(url: string, status = 0, links = 0, forms = 0): void {
    const { scope } = this.boundary.classifyUrl(url)
    if (!this.seenPages.has(url)) {
      this.seenPages.add(url)
      this.state.visitedUrls.push(url)
      this.state.pagesSeen++
    }
    this.touch()
    this.emit({ type: 'page_seen', url, scope, pages: this.state.pagesSeen, forms, state: this.snapshot() })
    emitSpiderPage(url, status, links, forms)
  }

  recordEndpoint(method: string, url: string, params: string[] = [], sourcePage?: string): void {
    const { scope } = this.boundary.classifyUrl(url)
    const key = `${method}:${url}`
    if (!this.seenEndpoints.has(key)) {
      this.seenEndpoints.add(key)
      this.state.endpoints.push({ method, url, params, scope, sourcePage })
    }
    this.touch()
    this.emit({ type: 'endpoint_seen', method, url, params, scope, endpoints: this.state.endpoints.length, state: this.snapshot() })
    emitSpiderEndpoint(method, url, params)
  }

  recordForm(url: string, selector?: string, method?: string, action?: string, role?: string): void {
    const key = `${url}:${selector ?? action ?? ''}`
    if (!this.seenForms.has(key)) {
      this.seenForms.add(key)
      this.state.discoveredForms.push({ url, selector, method, action, role })
    }
    this.touch()
    this.emit({ type: 'form_seen', url, method, forms: this.state.discoveredForms.length, state: this.snapshot() })
  }

  recordAuth(url: string, state: string, role?: string): void {
    this.state.authStates.push({ url, state, role })
    this.touch()
    this.emit({ type: 'auth_detected', url, message: state, state: this.snapshot() })
  }

  recordProgress(useful: boolean, staleThreshold: number): SpiderStopReason | undefined {
    this.state.staleRounds = useful ? 0 : this.state.staleRounds + 1
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

  nextFrontierItem(): FrontierItem | undefined {
    while (this.state.frontier.length > 0) {
      const item = this.state.frontier.shift()!
      if (item.scope === 'allowed') {
        this.touch()
        return item
      }
      if (item.scope === 'proposed') this.emit({ type: 'scope_proposed', url: item.url, scope: item.scope, state: this.snapshot() })
    }
    this.touch()
    return undefined
  }

  stop(reason: SpiderStopReason): void {
    this.state.stopReason = reason
    this.touch()
    this.emit({ type: 'crawl_completed', reason, state: this.snapshot() })
  }

  shouldStopByLimits(maxPages: number, maxDepth: number): SpiderStopReason | undefined {
    if (this.state.pagesSeen >= maxPages) return 'max_pages'
    if (this.state.frontier.some((item) => item.scope === 'allowed' && item.depth <= maxDepth)) return undefined
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
  graphStore?: { queryNodes?: (type?: NodeType) => GraphNodeData[]; save?: () => Promise<void> }
  workflowId?: string
  initialState?: Partial<SpiderRuntimeState>
  onEvent?: (event: SpiderRuntimeEvent) => void
  onText?: (text: string) => void
  onMessage?: (msg: SolverStreamMessage) => void
  onPhase?: (event: PhaseEvent) => void
  signal?: AbortSignal
}

export async function runSpiderRuntime(options: SpiderRunOptions): Promise<SpiderRuntimeState> {
  const { config, target, browser, memory, threadId, resourceId, graphStore } = options
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
  })
  const startedAt = Date.now()
  const deadline = startedAt + maxDurationMs

  runtime.start()
  runtime.enqueue(target, 0)
  emitSpiderStart(target, maxPages, maxDurationMs)

  let counts = collectGraphState(graphStore)
  let stopReason: SpiderStopReason | undefined

  try {
    const spiderAgent = createSpiderAgent(config, memory, browser)
    const streamPrompt = buildSpiderPrompt(target)
    const result = await Promise.race([
      spiderAgent.stream(streamPrompt, {
        memory: threadId && resourceId
          ? { thread: `${threadId}-spider`, resource: `${resourceId}-spider` }
          : undefined,
        maxSteps: config.spider?.maxSteps ?? config.agent.maxSteps,
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error(`Spider stream init timed out after ${maxDurationMs}ms`)), maxDurationMs)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      }),
    ])

    const stream = (result as any).fullStream ?? textStreamAsChunks((result as any).textStream)
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
        const nextCounts = collectGraphState(graphStore)
        ingestGraphDiff(runtime, counts, nextCounts)
        const useful = nextCounts.endpoints.size > counts.endpoints.size || nextCounts.pages.size > counts.pages.size || nextCounts.forms.size > counts.forms.size
        counts = nextCounts
        stopReason = runtime.recordProgress(useful, staleThreshold)
        if (stopReason) break
      }

      stopReason = runtime.shouldStopByLimits(maxPages, maxDepth)
      if (stopReason) break
    }

    const finalCounts = collectGraphState(graphStore)
    ingestGraphDiff(runtime, counts, finalCounts)

    await graphStore?.save?.()
    stopReason ??= 'frontier_exhausted'
    runtime.stop(stopReason)
    const finalState = runtime.snapshot()
    emitSpiderComplete(finalState.pagesSeen, finalState.endpoints.length, Date.now() - startedAt)
    return finalState
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(message)
    emitSpiderError(target, message)
    runtime.stop('error')
    await graphStore?.save?.().catch(() => {})
    return runtime.snapshot()
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
  for (const page of graphStore?.queryNodes?.(NodeType.PAGE) ?? []) pages.set(String(page.properties.url ?? page.id), page)
  for (const endpoint of graphStore?.queryNodes?.(NodeType.ENDPOINT) ?? []) {
    endpoints.set(`${endpoint.properties.method ?? 'GET'}:${endpoint.properties.url ?? endpoint.id}`, endpoint)
  }
  for (const form of graphStore?.queryNodes?.(NodeType.INPUT) ?? []) forms.set(`${form.properties.url ?? ''}:${form.properties.selector ?? form.id}`, form)
  return { pages, endpoints, forms }
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
}

function summarizeToolResult(result: unknown): string {
  if (typeof result === 'string') return result.slice(0, 500)
  try {
    return JSON.stringify(result).slice(0, 500)
  } catch {
    return String(result).slice(0, 500)
  }
}

function stableTargetId(target: string): string {
  return target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'target'
}
