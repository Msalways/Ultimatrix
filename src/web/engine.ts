/**
 * WebEngine — Server-side engine for the Next.js Web UI.
 *
 * The web entrypoint shares the cold solver runtime used by the CLI. Browser,
 * capture, crawl, workers, connectors, and council remain deferred until the
 * UI or agent activates the corresponding capability.
 */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { getConfigPath, getProvidersPath, loadConfig, type UltimatrixConfig } from '../config'
import { GraphStore } from '../graph/store'
import { OastStore } from '../oast/store'
import { solve, type SolverStreamMessage, type SolveResult, type PhaseEvent, type SolverConfig } from '../solver/solver'
import { ForensicLog } from '../logging/forensic-log'
import { createEngineServices, type EngineServices } from '../session/engine-setup'
import { createMemory, createMemoryStore } from '../workers/registry'
import { startDialogWatcher } from '../browser/dialog-watcher'
import { setOastConfig } from '../oast/server'
import { setScopeConfig, setExternalToolsConfig, deriveScopeFromTarget } from '../safety/scope-guard'
import { emitBrowserHumanAction, type TypedEventEmitter } from '../events/emitter'
import type { SpiderRuntime, SpiderRuntimeState } from '../spider/runtime'
import { spiderEventToPhase } from '../spider/render'
import type { WorkflowStore } from '../workflow/store'
import { createEngagementRuntime, type EngagementRuntime } from '../runtime/engagement-runtime'
import { log } from '../utils/logger'
import { generateSpecCode } from '../recorder/codegen'
import { getBrowserState } from '../browser/manager'
import type { RuntimeIdentity } from '../runtime/identity'

export interface WebEngineOpts {
  target: string
  configOverrides?: Partial<UltimatrixConfig>
}

export interface WebWorkerEvent {
  workerId: string
  workerName: string
  skillId: string
  task: string
  status: string
  startedAt: number
  completedAt?: number
  durationMs?: number
  toolCalls: number
}

export class WebEngine {
  readonly id: string
  readonly target: string
  private config!: UltimatrixConfig
  private graphStore!: GraphStore
  private oastStore!: OastStore
  private engineServices!: EngineServices
  private memory?: Awaited<ReturnType<typeof createMemory>>
  private memoryStore?: Awaited<ReturnType<typeof createMemoryStore>>
  private _threadId?: string
  private _resourceId = 'ultimatrix-web'
  private forensicLog?: ForensicLog
  private _initialized = false
  private _running = false
  private _abortController: AbortController | null = null
  private _cleanupFns: Array<() => Promise<void>> = []
  private _configPath = ''
  private _configFingerprint = ''
  private _providersPath = ''
  private _spiderState?: SpiderRuntimeState
  /** Live runtime handle retained so mid-crawl approvals take effect. */
  private _spiderRuntime?: SpiderRuntime
  /** Slice 02 — workflow-owned state for this engine (persisted per target). */
  private _workflow?: WorkflowStore
  /** Proposed origins the user approved for this engine (persists across crawls). */
  private _approvedOrigins: string[] = []
  private runtime?: EngagementRuntime
  private workerEvents: WebWorkerEvent[] = []

  constructor(target: string) {
    this.id = randomUUID()
    this.target = target
  }

  async init(opts: WebEngineOpts): Promise<void> {
    this._configPath = getConfigPath()
    this._providersPath = getProvidersPath()
    const baseConfig = await loadConfig()
    this._configFingerprint = this.buildConfigFingerprint(baseConfig)
    this.config = opts.configOverrides
      ? { ...baseConfig, ...opts.configOverrides, target: opts.target }
      : { ...baseConfig, target: opts.target }
    this.runtime = await createEngagementRuntime(this.config, opts.target)

    return this.runtime.run(async () => {

    this.attachWorkerEventTracking()

    const workspace = this.runtime!.workspace
    this.graphStore = this.runtime!.graph
    this.oastStore = this.runtime!.oast

    // Slice 02 — workflow-owned state: load a persisted snapshot for this target
    // or create a fresh one. The workflowId is the stable crawl/evidence/artifact
    // identity; artifacts created during the session fold in via the typed listener.
    this._workflow = this.runtime!.workflow

    const targetDir = workspace.getTargetDir(opts.target)
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
    const dbPath = resolve(targetDir, 'ultimatrix.db')
    this.memoryStore = await createMemoryStore(dbPath)
    this.memory = await createMemory(this.config, this.memoryStore, dbPath, { mainAgent: true })
    await this.ensureMemoryThread()

    this.forensicLog = this.runtime!.forensicLog

    // Scope guard — same as CLI
    const scopeConfig = this.config.scope ?? (opts.target ? deriveScopeFromTarget(opts.target) : null)
    setScopeConfig(scopeConfig)
    // External-tool policy: opt-in only (deny by default)
    setExternalToolsConfig(this.config.externalTools ?? null)

    // Expensive browser, OAST, and capture services remain cold.
    this.registerCleanup(async () => {
      try { this.runtime?.services.reactionObserver.detach() } catch {}
      try { this.runtime?.services.humanObserver.detach() } catch {}
    })

    // Engine services (brain, worker pool, skill registry, blackboard, evidence, council, model selector)
    this.engineServices = await createEngineServices({
      config: this.config,
      memory: this.memory,
      target: opts.target,
      identity: this.runtimeIdentity,
      workflow: this._workflow,
      runtime: this.runtime,
      approvedOrigins: this._approvedOrigins,
    })
    this.registerCleanup(() => this.engineServices.extensionRegistry?.closeAll() ?? Promise.resolve())
    this.registerCleanup(() => this.engineServices.lazyServices?.close() ?? Promise.resolve())
    // Self-evolution (spec 05): engagement summary → anonymized cross-session memory.
    this.registerCleanup(async () => {
      try {
        const { finalizeEngagementMemory } = await import('../intelligence/cross-engagement')
        await finalizeEngagementMemory(undefined, opts.target)
      } catch {
        /* evolution is best-effort */
      }
    })

    this._initialized = true
    log.info(`[WebEngine] Initialized cold for target: ${opts.target}`)
    })
  }

  async solve(params: {
    goal: string
    interactionMode?: 'ask' | 'run'
    solverConfig?: SolverConfig
    onMessage?: (msg: SolverStreamMessage) => void
    onPhase?: (event: PhaseEvent) => void
  }): Promise<SolveResult> {
    if (!this.runtime) throw new Error('WebEngine not initialized')
    return this.runtime.run(() => this.solveOwned(params))
  }

  private async solveOwned(params: {
    goal: string
    interactionMode?: 'ask' | 'run'
    solverConfig?: SolverConfig
    onMessage?: (msg: SolverStreamMessage) => void
    onPhase?: (event: PhaseEvent) => void
  }): Promise<SolveResult> {
    if (!this._initialized) throw new Error('WebEngine not initialized')
    if (this._running) throw new Error('WebEngine already running a solve')

    this._running = true
    const abortController = new AbortController()
    this._abortController = abortController

    try {
      this.engineServices.lazyServices?.setTurnObservers({
        onSpiderEvent: event => params.onPhase?.(spiderEventToPhase(event)),
        onSpiderRuntime: runtime => { this._spiderRuntime = runtime },
      })

      const result = await solve(this.engineServices.solverBrain!, {
        origin: this.target,
        goal: params.goal,
        interactionMode: params.interactionMode,
        config: params.solverConfig,
        ultimatrixConfig: this.config,
        blackboard: this.engineServices.sessionBlackboard,
        evidence: this.engineServices.sessionEvidence,
        loopDetector: this.engineServices.sessionLoopDetector,
        reflexion: this.engineServices.sessionReflexion,
        onMessage: params.onMessage,
        onPhase: params.onPhase,
        memory: { thread: this.runtimeIdentity.threadId, resource: this.runtimeIdentity.resourceId },
        signal: abortController.signal,
        workflow: this._workflow,
      })
      this._spiderState = this.engineServices.lazyServices?.crawlState

      // Graph auto-save after each solve
      await this.graphStore?.save().catch(() => {})

      return result
    } finally {
      this._running = false
      if (this._abortController === abortController) this._abortController = null
    }
  }

  abort(): void {
    this._abortController?.abort()
  }

  /**
   * Proposed-scope approval workflow (slice 03). Approves a discovered
   * `proposed` URL/origin: expands the live runtime boundary (reclassifying any
   * already-discovered proposed items from that origin) and remembers the
   * approval for subsequent crawls on this engine.
   */
  approveProposed(url: string): { ok: boolean; proposedOrigins: string[]; approvedProposals: string[] } {
    const origin = (() => {
      try {
        return new URL(url).origin
      } catch {
        return url
      }
    })()
    if (!this._approvedOrigins.includes(origin)) this._approvedOrigins.push(origin)
    this._spiderRuntime?.approveProposed(url)
    const state = this._spiderRuntime?.snapshot() ?? this._spiderState
    return {
      ok: true,
      proposedOrigins: state?.proposedOrigins ?? [],
      approvedProposals: this._spiderRuntime?.boundary.approvedProposals ?? this._approvedOrigins,
    }
  }

  /** Current proposed/approved scope state for the UI (empty before first crawl). */
  getSpiderProposals(): { proposedOrigins: string[]; approvedProposals: string[]; state?: SpiderRuntimeState } {
    const state = this._spiderRuntime?.snapshot() ?? this._spiderState
    return {
      proposedOrigins: state?.proposedOrigins ?? [],
      approvedProposals: this._spiderRuntime?.boundary.approvedProposals ?? this._approvedOrigins,
      state,
    }
  }

  getGraph(): GraphStore {
    return this.graphStore
  }

  getConfig(): UltimatrixConfig {
    return this.config
  }

  getFindings() {
    return this.graphStore.queryNodes(undefined).filter(
      (n: any) => n.type === 'Finding'
    )
  }

  getSkillRegistry() {
    return this.engineServices?.skillRegistry
  }

  isInitialized(): boolean {
    return this._initialized
  }

  isRunning(): boolean {
    return this._running
  }

  /**
   * Check if config changed in a way that affects engine behavior.
   * Only returns true for fields that actually affect runtime (provider, model, engine type, browser settings).
   * Ignores cosmetic changes like timestamp updates, scope, spider settings, etc.
   */
  isConfigStale(): boolean {
    try {
      const currentConfig = loadConfig() as any
      return this.buildConfigFingerprint(currentConfig) !== this._configFingerprint
    } catch {
      return false
    }
  }

  private buildConfigFingerprint(config: any): string {
    return JSON.stringify({
      provider: config.provider,
      model: config.model,
      engine: config.engine,
      browserProvider: config.browser?.provider,
      browserHeadless: config.browser?.headless,
      browserEnv: config.browser?.env,
    })
  }

  /**
   * Hot-reload config from disk without destroying the engine.
   * Rebuilds engine services (brain, skill registry, blackboard, evidence, etc.)
   * but does NOT touch browser, spider state, or page navigation.
   */
  async reloadConfig(): Promise<void> {
    if (!this.runtime) return
    return this.runtime.run(() => this.reloadConfigOwned())
  }

  getEvents(): TypedEventEmitter {
    if (!this.runtime) throw new Error('WebEngine not initialized')
    return this.runtime.services.events
  }

  getWorkerEventSnapshot(): { workers: WebWorkerEvent[]; recent: WebWorkerEvent[]; count: number } {
    const workers = this.workerEvents.filter(worker => worker.status === 'running')
    return { workers, recent: this.workerEvents.slice(-20), count: workers.length }
  }

  getCode(): string[] {
    const testCases = this.runtime?.services.recorder?.getTestCases() ?? []
    if (testCases.length === 0) return []
    const lines = generateSpecCode(testCases, 'web-viewer').split('\n')
    const chunks: string[] = []
    for (let index = 0; index < lines.length; index += 50) {
      chunks.push(lines.slice(index, index + 50).join('\n'))
    }
    return chunks
  }

  getBrowserState(): ReturnType<typeof getBrowserState> {
    if (!this.runtime) throw new Error('WebEngine not initialized')
    return this.runtime.run(() => getBrowserState())
  }

  async startBrowser(): Promise<ReturnType<typeof getBrowserState>> {
    if (!this.runtime || !this.engineServices.lazyServices) throw new Error('WebEngine not initialized')
    return this.runtime.run(async () => {
      const browser = await this.engineServices.lazyServices!.ensureBrowser()
      startDialogWatcher(browser)
      await this.attachHumanObserver()
      return getBrowserState()
    })
  }

  private async reloadConfigOwned(): Promise<void> {
    if (!this._initialized) return
    try {
      const freshConfig = await loadConfig()
      const newFingerprint = this.buildConfigFingerprint(freshConfig)
      if (newFingerprint === this._configFingerprint) return // no meaningful change

      this.config = { ...freshConfig, target: this.target }
      this._configFingerprint = newFingerprint
      const requestedProvider = this.config.browser.provider ?? 'stagehand'
      if (requestedProvider !== this.runtime?.browser.name) {
        throw new Error(`Browser provider cannot change during an engagement (${this.runtime?.browser.name} -> ${requestedProvider})`)
      }

      // Rebuild engine services (brain, worker pool, skill registry, blackboard, evidence, council, model selector)
      await this.engineServices.lazyServices?.close()
      await this.engineServices.extensionRegistry?.closeAll()
      this.engineServices = await createEngineServices({
        config: this.config,
        memory: this.memory,
        target: this.target,
        identity: this.runtimeIdentity,
        workflow: this._workflow,
        runtime: this.runtime,
        approvedOrigins: this._approvedOrigins,
      })

      // Update scope guard
      const scopeConfig = this.config.scope ?? (this.target ? deriveScopeFromTarget(this.target) : null)
      setScopeConfig(scopeConfig)
      // Update external-tool policy (opt-in only)
      setExternalToolsConfig(this.config.externalTools ?? null)

      // Update OAST config
      setOastConfig(this.config.oast ?? null)

      log.info(`[WebEngine] Config hot-reloaded for target: ${this.target}`)
    } catch (err) {
      log.warn(`[WebEngine] Config reload failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private get threadId(): string {
    return this._threadId ?? `ultimatrix-web-${this.target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
  }

  private get resourceId(): string {
    return this._resourceId
  }

  private get runtimeIdentity(): RuntimeIdentity {
    if (!this._workflow) throw new Error('WebEngine identity requested before workflow initialization')
    return {
      threadId: this.threadId,
      resourceId: this.resourceId,
      workflowId: this._workflow.state.workflowId,
      target: this.target,
    }
  }

  private async attachHumanObserver(): Promise<void> {
    const observer = this.runtime!.services.humanObserver
    const page = await this.runtime?.browser.getActivePage(this.runtime.browserSession!.sessionId) as any
    if (!page) return

    observer.onAction((action) => {
      emitBrowserHumanAction(action.type, action.url, action.selector)
      this.forensicLog?.log({
        type: 'human-action',
        agent: 'human',
        args: {
          type: action.type,
          selector: action.selector,
          url: action.url,
          value: action.value,
        },
      })
    })

    observer.attach(page)
    if (!this.config.browser.headless) {
      log.info('[WebEngine] Human action capture attached to the visible browser')
    }
  }

  private async ensureMemoryThread(): Promise<void> {
    if (!this.memory) return

    const threadBase = `ultimatrix-web-${this.target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
    const { threads } = await this.memory.listThreads({ filter: { resourceId: this.resourceId } })
    const existing = threads.find((thread: any) => thread.id === threadBase || thread.id.startsWith(threadBase))
    this._threadId = existing?.id ?? threadBase

    if (!existing) {
      await this.memory.saveThread({
        thread: {
          id: this._threadId,
          title: `Ultimatrix Web - ${this.target}`,
          resourceId: this.resourceId,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { targetUrl: this.target, surface: 'web' },
        },
      })
    }
  }

  private registerCleanup(fn: () => Promise<void>): void {
    this._cleanupFns.push(fn)
  }

  async destroy(): Promise<void> {
    if (this.runtime) return this.runtime.run(() => this.destroyOwned())
    return this.destroyOwned()
  }

  private attachWorkerEventTracking(): void {
    const bus = this.getEvents()
    const onSpawned = (event: any) => {
      this.workerEvents.push({
        workerId: event.workerId,
        workerName: event.workerName,
        skillId: event.skillId,
        task: event.task,
        status: 'running',
        startedAt: event.timestamp,
        toolCalls: 0,
      })
      if (this.workerEvents.length > 50) this.workerEvents.splice(0, this.workerEvents.length - 50)
    }
    const onFinished = (event: any, status: string) => {
      const worker = this.workerEvents.find(item => item.workerId === event.workerId)
      if (!worker) return
      worker.status = status
      worker.completedAt = event.timestamp
      worker.durationMs = event.durationMs
    }
    const onToolCall = (event: any) => {
      const worker = this.workerEvents.find(item => item.workerId === event.workerId)
      if (worker) worker.toolCalls++
    }
    const onCompleted = (event: any) => onFinished(event, 'completed')
    const onError = (event: any) => onFinished(event, 'error')

    bus.on('worker:spawned', onSpawned)
    bus.on('worker:completed', onCompleted)
    bus.on('worker:error', onError)
    bus.on('worker:tool-call', onToolCall)
    this.registerCleanup(async () => {
      bus.off('worker:spawned', onSpawned)
      bus.off('worker:completed', onCompleted)
      bus.off('worker:error', onError)
      bus.off('worker:tool-call', onToolCall)
    })
  }

  private async destroyOwned(): Promise<void> {
    this._initialized = false
    this._running = false
    this._abortController?.abort()
    this._abortController = null
    this.forensicLog = undefined

    // Run cleanups in reverse order (LIFO)
    for (const fn of this._cleanupFns.reverse()) {
      try {
        await fn()
      } catch (err) {
        log.dim(`[WebEngine] Cleanup error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    this._cleanupFns = []
    if (this.runtime) await this.runtime.close({ status: 'aborted', reason: 'web engine destroyed' })
  }
}
