/**
 * WebEngine — Server-side engine for the Next.js Web UI.
 *
 * Full CLI parity: browser, spider, memory, scope guard, OAST, dialog watcher,
 * human observer, HAR capture, model capability check, conversation persistence,
 * graph auto-save.
 *
 * Design decisions (see plan §Design Decisions):
 * - Spider runs on first solve, not init — fast startup
 * - Browser follows config.headless — user-configurable
 * - Scope guard from config — same as CLI
 * - Memory uses `ultimatrix-web-<target>` prefix — no CLI conflicts
 * - Cleanup on destroy() — stops browser, OAST, dialog watcher
 */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { getConfigPath, getProvidersPath, loadConfig, type UltimatrixConfig } from '../config'
import { getGlobalWorkspace } from '../workspace'
import { GraphStore } from '../graph/store'
import { OastStore } from '../oast/store'
import { solve, type SolverStreamMessage, type SolveResult, type PhaseEvent, type SolverConfig } from '../solver/solver'
import { ForensicLog } from '../logging/forensic-log'
import { setForensicLog } from '../tools/report-tools'
import { createEngineServices, type EngineServices } from '../session/engine-setup'
import { createMemory, createMemoryStore } from '../workers/registry'
import { getOrCreateBrowser, getActivePage } from '../browser/manager'
import { startDialogWatcher, stopDialogWatcher } from '../browser/dialog-watcher'
import { getGlobalObserver } from '../capture/human-observer'
import { startOastServer, stopOastServer, setOastConfig } from '../oast/server'
import { setScopeConfig, deriveScopeFromTarget } from '../safety/scope-guard'
import { getGlobalReactionObserver } from '../browser/reaction-observer'
import { emitBrowserHumanAction } from '../events/emitter'
import { runSpiderRuntime, type SpiderRuntimeState } from '../spider/runtime'
import { log } from '../utils/logger'
import { loadSkill } from '../solver/skills/loader'

export interface WebEngineOpts {
  target: string
  configOverrides?: Partial<UltimatrixConfig>
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
  private _spiderRan = false

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

    const workspace = getGlobalWorkspace()
    const { graphStore, oastStore } = await workspace.switchTarget(opts.target)
    this.graphStore = graphStore
    this.oastStore = oastStore

    const targetDir = workspace.getTargetDir(opts.target)
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
    const dbPath = resolve(targetDir, 'ultimatrix.db')
    this.memoryStore = await createMemoryStore(dbPath)
    this.memory = await createMemory(this.config, this.memoryStore, dbPath)
    await this.ensureMemoryThread()

    const forensicLogPath = resolve(workspace.getTargetDir(opts.target), 'forensic.ndjson')
    this.forensicLog = new ForensicLog(forensicLogPath)
    setForensicLog(this.forensicLog)

    // Scope guard — same as CLI
    const scopeConfig = this.config.scope ?? (opts.target ? deriveScopeFromTarget(opts.target) : null)
    setScopeConfig(scopeConfig)

    // Browser — follows config.headless
    const browser = getOrCreateBrowser(this.config)
    await browser.ensureReady()
    startDialogWatcher(browser)
    this.attachHumanObserver()

    // OAST server
    setOastConfig(this.config.oast ?? null)
    const oastPort = await startOastServer()
    this.registerCleanup(async () => {
      log.dim('[WebEngine] Stopping OAST server...')
      await stopOastServer()
    })
    this.registerCleanup(async () => {
      log.dim('[WebEngine] Stopping dialog watcher and detaching observers...')
      stopDialogWatcher()
      try { getGlobalReactionObserver().detach() } catch {}
      try { getGlobalObserver().detach() } catch {}
      // Browser is a process-level singleton — do NOT close it here.
      // Closing the browser kills the Chromium process for ALL engines.
      // The browser lifecycle is managed externally (TTL cleanup / graceful shutdown).
    })

    // Navigate to target if set
    if (opts.target) {
      const page = getActivePage()
      if (page) {
        try {
          log.info(`[WebEngine] Navigating to ${opts.target}...`)
          const response = await page.goto(opts.target, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const status = response?.status() || 'unknown'
          const title = await page.title().catch(() => '')
          log.info(`[WebEngine] Loaded ${opts.target} — status: ${status}, title: "${title}"`)
        } catch (err) {
          log.warn(`[WebEngine] Initial navigation failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    // Engine services (brain, worker pool, skill registry, blackboard, evidence, council, model selector)
    this.engineServices = await createEngineServices({
      config: this.config,
      browser,
      memory: this.memory,
      target: opts.target,
    })

    this._initialized = true
    log.info(`[WebEngine] Initialized for target: ${opts.target} (OAST: :${oastPort})`)
  }

  async solve(params: {
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
      // Auto-crawl on first solve — spider runs once per target, not per engine instance
      if (!this._spiderRan && this.target && this.config.spider?.enabled !== false) {
        await this.runSpider(params.onMessage, params.onPhase)
        this._spiderRan = true
      }

      // Pre-load top-matching skill bodies for this goal
      let matchedSkills: any[] | undefined
      const skillRegistry = this.engineServices.skillRegistry
      if (skillRegistry && params.goal.trim().length > 3) {
        const candidates = skillRegistry.search(params.goal.trim()).slice(0, 3)
        const loaded = candidates.map(m => loadSkill(m.id)).filter(Boolean)
        if (loaded.length > 0) matchedSkills = loaded
      }

      const result = await solve(this.engineServices.solverBrain!, {
        origin: this.target,
        goal: params.goal,
        interactionMode: params.interactionMode,
        config: params.solverConfig,
        ultimatrixConfig: this.config,
        matchedSkills,
        blackboard: this.engineServices.sessionBlackboard,
        evidence: this.engineServices.sessionEvidence,
        loopDetector: this.engineServices.sessionLoopDetector,
        reflexion: this.engineServices.sessionReflexion,
        onMessage: params.onMessage,
        onPhase: params.onPhase,
        memory: { thread: this.threadId, resource: this.resourceId },
        signal: abortController.signal,
      })

      // Graph auto-save after each solve
      await this.graphStore?.save().catch(() => {})

      return result
    } finally {
      this._running = false
      if (this._abortController === abortController) this._abortController = null
    }
  }

  /**
   * Run the spider agent to crawl the target.
   * Extracted from lifecycle.ts for Web parity.
   */
  private async runSpider(
    onMessage?: (msg: SolverStreamMessage) => void,
    onPhase?: (event: PhaseEvent) => void,
  ): Promise<void> {
    const browser = getOrCreateBrowser(this.config)
    this._spiderState = await runSpiderRuntime({
      config: this.config,
      target: this.target,
      browser,
      graphStore: this.graphStore as any,
      workflowId: this.id,
      initialState: this._spiderState,
      onMessage,
      onPhase,
      signal: this._abortController?.signal,
      onEvent: (event) => {
        if (event.type === 'crawl_progress') {
          onPhase?.({ phase: 'observe', step: 0, text: `[Spider] ${event.pages ?? 0} pages, ${event.endpoints ?? 0} endpoints, ${event.forms ?? 0} forms` })
        } else if (event.type === 'crawl_stalled') {
          onPhase?.({ phase: 'stale', step: 0, reason: String(event.reason ?? 'stale') })
        } else if (event.type === 'scope_proposed' && event.url) {
          onPhase?.({ phase: 'observe', step: 0, text: `[Spider] scope proposed: ${event.url}` })
        }
      },
    })
  }

  abort(): void {
    this._abortController?.abort()
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
    if (!this._initialized) return
    try {
      const freshConfig = await loadConfig()
      const newFingerprint = this.buildConfigFingerprint(freshConfig)
      if (newFingerprint === this._configFingerprint) return // no meaningful change

      this.config = { ...freshConfig, target: this.target }
      this._configFingerprint = newFingerprint

      // Rebuild engine services (brain, worker pool, skill registry, blackboard, evidence, council, model selector)
      const browser = getOrCreateBrowser(this.config)
      this.engineServices = await createEngineServices({
        config: this.config,
        browser,
        memory: this.memory,
        target: this.target,
      })

      // Update scope guard
      const scopeConfig = this.config.scope ?? (this.target ? deriveScopeFromTarget(this.target) : null)
      setScopeConfig(scopeConfig)

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

  private attachHumanObserver(): void {
    const observer = getGlobalObserver()
    const page = getActivePage()
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
  }
}
