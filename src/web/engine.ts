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
import { loadConfig, type UltimatrixConfig } from '../config'
import { getGlobalWorkspace } from '../workspace'
import { GraphStore } from '../graph/store'
import { OastStore } from '../oast/store'
import { solve, type SolverStreamMessage, type SolveResult, type PhaseEvent, type SolverConfig } from '../solver/solver'
import { ForensicLog } from '../logging/forensic-log'
import { setForensicLog } from '../tools/report-tools'
import { createEngineServices, type EngineServices } from '../session/engine-setup'
import { getOrCreateBrowser, closeBrowser, getActivePage } from '../browser/manager'
import { startDialogWatcher, stopDialogWatcher } from '../browser/dialog-watcher'
import { startOastServer, stopOastServer, setOastConfig } from '../oast/server'
import { setScopeConfig, deriveScopeFromTarget } from '../safety/scope-guard'
import { createSpiderAgent } from '../spider/agent'
import { buildSpiderPrompt } from '../spider/instructions'
import { getGlobalReactionObserver } from '../browser/reaction-observer'
import { LoopDetector } from '../intelligence/anti-loop'
import { NodeType } from '../graph/schema'
import { emitSpiderStart, emitSpiderComplete, emitSpiderError } from '../events/emitter'
import { log } from '../utils/logger'
import { DEFAULTS } from '../config'
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
  private forensicLog?: ForensicLog
  private _initialized = false
  private _running = false
  private _spiderRan = false
  private _abortController: AbortController | null = null
  private _cleanupFns: Array<() => Promise<void>> = []

  constructor(target: string) {
    this.id = randomUUID()
    this.target = target
  }

  async init(opts: WebEngineOpts): Promise<void> {
    const baseConfig = await loadConfig()
    this.config = opts.configOverrides
      ? { ...baseConfig, ...opts.configOverrides, target: opts.target }
      : { ...baseConfig, target: opts.target }

    const workspace = getGlobalWorkspace()
    const { graphStore, oastStore } = await workspace.switchTarget(opts.target)
    this.graphStore = graphStore
    this.oastStore = oastStore

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

    // OAST server
    setOastConfig(this.config.oast ?? null)
    const oastPort = await startOastServer()
    this.registerCleanup(async () => {
      log.dim('[WebEngine] Stopping OAST server...')
      await stopOastServer()
    })
    this.registerCleanup(async () => {
      log.dim('[WebEngine] Closing browser...')
      stopDialogWatcher()
      try { getGlobalReactionObserver().detach() } catch {}
      await closeBrowser()
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
      memory: undefined,
      target: opts.target,
    })

    this._initialized = true
    log.info(`[WebEngine] Initialized for target: ${opts.target} (OAST: :${oastPort})`)
  }

  async solve(params: {
    goal: string
    solverConfig?: SolverConfig
    onMessage?: (msg: SolverStreamMessage) => void
    onPhase?: (event: PhaseEvent) => void
  }): Promise<SolveResult> {
    if (!this._initialized) throw new Error('WebEngine not initialized')
    if (this._running) throw new Error('WebEngine already running a solve')

    this._running = true
    this._abortController = new AbortController()

    try {
      // Auto-crawl on first solve — spider runs once per engine lifetime
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
      })

      // Graph auto-save after each solve
      await this.graphStore?.save().catch(() => {})

      return result
    } finally {
      this._running = false
      this._abortController = null
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
    const spiderAgent = createSpiderAgent(this.config, undefined, browser)
    const spiderLoopDetector = new LoopDetector(this.config.antiLoop?.maxFailedTarget ?? DEFAULTS.antiLoop.maxFailedTarget)
    const staleThreshold = this.config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold
    const spiderMaxDurationMs = this.config.spider?.maxDurationMs ?? 120_000

    emitSpiderStart(this.target, this.config.spider?.maxSteps ?? 100, spiderMaxDurationMs)

    try {
      const streamPrompt = buildSpiderPrompt(this.target)

      const result = await Promise.race([
        spiderAgent.stream(
          streamPrompt,
          { maxSteps: this.config.spider?.maxSteps ?? this.config.agent.maxSteps },
        ),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Spider timed out after ${spiderMaxDurationMs}ms`)),
            spiderMaxDurationMs,
          )
          if (typeof timer === 'object' && 'unref' in timer) timer.unref()
        }),
      ])

      let endpointsBefore = 0
      let pagesBefore = 0
      let findingsBefore = 0

      for await (const chunk of result.textStream) {
        if (typeof chunk !== 'string') continue
        if (chunk.includes('tool-call') || chunk.includes('tool-result')) continue

        const endpointsNow = this.graphStore?.queryNodes?.(NodeType.ENDPOINT)?.length ?? 0
        const pagesNow = this.graphStore?.queryNodes?.(NodeType.PAGE)?.length ?? 0
        const findingsNow = this.graphStore?.queryNodes?.(NodeType.FINDING)?.length ?? 0
        const newEndpoints = endpointsNow - endpointsBefore
        const newPages = pagesNow - pagesBefore
        const newFindings = findingsNow - findingsBefore

        if (newEndpoints > 0 || newPages > 0 || newFindings > 0) {
          onPhase?.({ phase: 'observe', step: 0, text: `[Spider] +${newEndpoints} endpoints, +${newPages} pages, +${newFindings} findings` })
        }

        spiderLoopDetector.recordRound(newEndpoints > 0)
        endpointsBefore = endpointsNow
        pagesBefore = pagesNow
        findingsBefore = findingsNow

        if (spiderLoopDetector.isStale(staleThreshold)) {
          log.warn('[WebEngine] Spider stale — stopping crawl')
          break
        }
      }

      await this.graphStore?.save()
      emitSpiderComplete(0, 0, spiderMaxDurationMs)
    } catch (err) {
      log.error(`[WebEngine] Spider error: ${err instanceof Error ? err.message : String(err)}`)
      emitSpiderError(this.target, err instanceof Error ? err.message : String(err))
    }
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

  private get threadId(): string {
    return `ultimatrix-web-${this.target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
  }

  private get resourceId(): string {
    return 'ultimatrix-web'
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
