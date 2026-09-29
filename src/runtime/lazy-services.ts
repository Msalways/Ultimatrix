import type { MastraMemory } from '@mastra/core/memory'
import type { UltimatrixConfig } from '../config'
import type { Blackboard } from '../core/blackboard'
import type { DynamicToolRegistry } from '../extensions/tool-registry'
import type { ModelSelector } from '../models/selector'
import { startOastServer, stopOastServer } from '../oast/server'
import { redactHarJson } from '../security/secret-vault'
import type { SkillRegistry } from '../solver/skills/registry'
import { runSpiderRuntime, type SpiderRuntime, type SpiderRuntimeEvent, type SpiderRuntimeState } from '../spider/runtime'
import type { WorkflowStore } from '../workflow/store'
import { WorkerPool } from '../workers/pool'
import { createWorkerTaskCoordinator } from './worker-pool-executor'
import type { TaskCoordinator } from './task-coordinator'
import type { EngagementRuntime } from './engagement-runtime'
import { attachHarCaptureViaCdp, type CdpCaptureHandle } from '../session/cdp-network-capture'
import { startHarCapture, type HarCapture } from '../session/har-capture'
import { bridgeHARToGraph } from '../analysis/har-bridge'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { wrapStagehandTools } from '../browser/dialog-inject'
import { log } from '../utils/logger'
import { ensureContextPage, registerBrowserHandle, __browserTraceIds } from '../browser/manager'
import type { RuntimeIdentity } from './identity'

type CaptureSession = {
  /** Drain completed entries while leaving the subscriber attached. */
  flush: () => Promise<string | null>
  /** Detach the subscriber; the provider/session owns browser shutdown. */
  stop: () => Promise<string | null>
  handle: CdpCaptureHandle | HarCapture
}

export type ObservationState =
  | { status: 'completed'; result: { requests: number; url: string } }
  | { status: 'failed'; error: string }

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface LazyWorkerServices {
  workerPool: WorkerPool
  taskCoordinator: TaskCoordinator
}

export interface LazySolverServicesOptions {
  config: UltimatrixConfig
  target: string
  identity?: RuntimeIdentity
  memory?: MastraMemory
  workflow?: WorkflowStore
  runtime?: EngagementRuntime
  skillRegistry: SkillRegistry
  modelSelector?: ModelSelector
  extensionRegistry: DynamicToolRegistry
  approvedOrigins?: string[]
}

/** Independently idempotent expensive services used only by activated capabilities. */
export class LazySolverServices {
  private browserValue?: any
  private browserPromise?: Promise<any>
  private captureValue?: CaptureSession
  private capturePromise?: Promise<CaptureSession>
  private capturePage?: any
  private oastPort?: number
  private oastPromise?: Promise<number>
  private crawlPromise?: Promise<SpiderRuntimeState>
  private workersValue?: LazyWorkerServices
  private workersPromise?: Promise<LazyWorkerServices>
  private councilValue?: import('../council/factory').CouncilResources
  private councilPromise?: Promise<import('../council/factory').CouncilResources>
  private onSpiderEvent?: (event: SpiderRuntimeEvent) => void
  private onSpiderRuntime?: (runtime: SpiderRuntime) => void
  private lastCrawlState?: SpiderRuntimeState
  /** Abort handle for the in-flight crawl. A timed-out race must stop the
   * spider instead of abandoning it: an un-aborted run keeps driving
   * browser/HTTP traffic detached from any turn or session. */
  private crawlController?: AbortController
  private researchBootstrapAttempted = false
  // Observation is engagement-scoped, not model-turn-scoped. Once the
  // browser provider has failed, a model fallback must consume that fact
  // instead of launching the same 45s startup attempt again.
  private lastObservationState?: ObservationState

  constructor(private readonly options: LazySolverServicesOptions) {}

  setTurnObservers(observers: { onSpiderEvent?: (event: SpiderRuntimeEvent) => void; onSpiderRuntime?: (runtime: SpiderRuntime) => void }): void {
    this.onSpiderEvent = observers.onSpiderEvent
    this.onSpiderRuntime = observers.onSpiderRuntime
  }

  async ensureBrowser(): Promise<any> {
    if (this.browserValue) return this.browserValue
    if (this.browserPromise) return this.browserPromise
    this.browserPromise = (async () => {
      if (!this.options.runtime) throw new Error('Browser capability requires a target-scoped runtime')
      const session = await this.options.runtime.startBrowser()
      this.options.runtime.services.dialogWatcher.attach(session.browser)
      this.browserValue = session.browser
      if (process.env.ULTIMATRIX_BROWSER_TRACE) {
        log.warn(`[browser-trace] ensureBrowser got handle=${__browserTraceIds.objId(session.browser)} from startBrowser()`)
      }
      // Register through the single accessor the readers use. Writing straight
      // into `runtime.services.browserManager` looked equivalent and was not:
      // getBrowserManagerState() resolves to the engagement services only while
      // inside runWithEngagementServices, and to the module-level fallback
      // otherwise. Same field, different object, and the browser silently read
      // back as absent — which is what kept every live run HTTP-only.
      registerBrowserHandle(session.browser)
      return session.browser
    })().finally(() => {
      this.browserPromise = undefined
    })
    return this.browserPromise
  }

  async getBrowserTools(): Promise<Record<string, any>> {
    return wrapStagehandTools(await this.ensureBrowser())
  }

  async ensureCapture(): Promise<CaptureSession> {
    if (this.captureValue) return this.captureValue
    if (this.capturePromise) return this.capturePromise
    this.capturePromise = (async () => {
      const browser = await this.ensureBrowser()
      await this.ensureOast()
      let capture: CaptureSession
      const serialize = (entries: unknown[]): string | null =>
        entries.length
          ? JSON.stringify({ log: { version: '1.2', creator: { name: 'ultimatrix', version: '8.0.0' }, entries } }, null, 2)
          : null
      // Phase A â€” provider-dispatched capture (no vendor sniffing).
      const { isCamofoxHandle } = await import('../browser/provider')
      if (isCamofoxHandle(browser)) {
        const { attachHarCaptureViaPlaywright } = await import('../session/playwright-network-capture')
        const handle = attachHarCaptureViaPlaywright(browser.context as any, {})
        capture = {
          handle,
          flush: async () => serialize(await handle.flush()),
          stop: async () => serialize(await handle.stop()),
        }
        this.options.workflow?.setCaptureSource('cdp') // live in-session capture (playwright transport)
      } else {
        const stagehand = browser?.requireStagehand?.()
        if (stagehand?.context?.conn) {
          const handle = attachHarCaptureViaCdp(stagehand, { captureResponseBody: true, captureRequestBody: true })
          if (handle.attached) {
            try {
              await handle.ready
              capture = {
                handle,
                flush: async () => serialize(await handle.flush()),
                stop: async () => serialize(await handle.stop()),
              }
              this.options.workflow?.setCaptureSource('cdp')
            } catch {
              // Stagehand deployments can expose a connection without the
              // Network CDP domain. Keep observation live via the generic
              // Playwright capture browser instead of losing the HAR.
              capture = await this.startFallbackCapture()
            }
          }
          else capture = await this.startFallbackCapture()
        } else {
          capture = await this.startFallbackCapture()
        }
      }
      await this.attachCaptureObservers()
      return capture
    })().then(capture => {
      this.captureValue = capture
      return capture
    }).finally(() => {
      this.capturePromise = undefined
    })
    return this.capturePromise
  }

  private async startFallbackCapture(): Promise<CaptureSession> {
    if (this.options.config.bounty?.enabled) {
      throw new Error('Authenticated bounty capture is unavailable; refusing anonymous fallback evidence')
    }
    // Never exclude the engagement target. Local Juice Shop/lab targets are
    // valid in-scope traffic, and excluding localhost made the fallback HAR
    // appear empty even when navigation succeeded.
    const handle = await startHarCapture(this.options.target, [])
    this.options.workflow?.setCaptureSource('anonymous-fallback')
    return { handle, flush: handle.flush, stop: handle.stop }
  }

  private async attachCaptureObservers(): Promise<void> {
    const runtime = this.options.runtime
    const sessionId = runtime?.browserSession?.sessionId
    if (!runtime || !sessionId) return
    const page = await runtime.browser.getActivePage(sessionId) as any
    if (!page) return
    this.capturePage = page
    if (!runtime.services.humanObserver.isCapturing()) runtime.services.humanObserver.attach(page)
    runtime.services.passiveObserver.attach(page)
  }

  async ensureOast(): Promise<number> {
    if (this.oastPort !== undefined) return this.oastPort
    if (this.oastPromise) return this.oastPromise
    this.oastPromise = startOastServer(0, this.options.runtime?.oast).then(port => {
      this.oastPort = port
      return port
    }).finally(() => {
      this.oastPromise = undefined
    })
    return this.oastPromise
  }

  async crawl(): Promise<SpiderRuntimeState> {
    if (this.crawlPromise) return this.crawlPromise
    const run = this.crawlOnce()
    this.crawlPromise = run
    // An abandoned race (turn timeout, session close) settles the detached
    // run via abortCrawl(); without this no-op catch that settlement
    // surfaces as an unhandled rejection after every participant moved on.
    run.catch(() => {})
    try {
      return await run
    } finally {
      if (this.crawlPromise === run) this.crawlPromise = undefined
    }
  }

  /**
   * Stop the in-flight crawl, if any. Safe to call when no crawl is running
   * (no-op) and after a crawl already settled (stale controller already
   * cleared). The next crawl() starts a fresh controller.
   */
  abortCrawl(reason = 'Crawl aborted'): void {
    try {
      this.crawlController?.abort(new Error(reason))
    } catch { /* abort must never throw */ }
  }

  /**
   * Deterministic baseline observation. This is intentionally separate from
   * the adaptive spider: a target page and its first-party traffic must be
   * captured even when the spider model stops, times out, or finds no links.
   */
  async observe(): Promise<{ requests: number; url: string }> {
    const { target, runtime } = this.options
    if (!runtime) throw new Error('Observation requires a target-scoped runtime')
    if (this.lastObservationState?.status === 'completed') return this.lastObservationState.result
    if (this.lastObservationState?.status === 'failed') {
      throw new Error(this.lastObservationState.error)
    }
    const observationTimeoutMs = Math.min(
      45_000,
      Math.max(10_000, Math.floor((this.options.config.solver?.maxDurationMs ?? 300_000) * 0.2)),
    )
    let capture: CaptureSession | undefined
    let page: any
    try {
      // Hold the HANDLE that ensureBrowser() returns. Reading it back off the
      // runtime did not work: `runtime.browser` is the BrowserProvider
      // (engagement-runtime.ts), which has no requireStagehand, so
      // `runtime.browser?.requireStagehand?.()?.context` was always undefined
      // and the provisioning attempt below could never open a page. This is the
      // type confusion that kept every live run HTTP-only — the browser started
      // fine and the observation path simply never had a handle to drive.
      const handle = await withTimeout(this.ensureBrowser(), observationTimeoutMs, 'Browser startup')
      capture = await withTimeout(this.ensureCapture(), observationTimeoutMs, 'Network capture setup')
      const sessionId = runtime.browserSession?.sessionId
      page = sessionId ? await runtime.browser.getActivePage(sessionId) as any : undefined
      if (process.env.ULTIMATRIX_BROWSER_TRACE) {
        const h: any = handle
        const sh = h?.requireStagehand?.()
        const ctx: any = sh?.context
        console.log('[bt] ' + JSON.stringify({
          handle: !!h,
          handleCtor: h?.constructor?.name,
          requireStagehand: typeof h?.requireStagehand,
          shCtor: sh?.constructor?.name,
          ctxCtor: ctx?.constructor?.name,
          ctxNewPage: typeof ctx?.newPage,
          ctxPages: typeof ctx?.pages,
          ctxActivePage: typeof ctx?.activePage,
          sessionId: sessionId ?? null,
          providerGotPage: !!page,
          pageGoto: typeof page?.goto,
        }))
      }
      if (!page || typeof page.goto !== 'function') {
        // A freshly started provider may expose no page at all, and the old code
        // treated that as fatal. It is not fatal: the provider can open one. This
        // was the difference between a working browser and a permanently
        // HTTP-only engagement — verified live 2026-09-28 across five runs
        // against a real application, where the failure silently zeroed auth
        // flows and RBAC roles because those capabilities live in the browser
        // layer. Provision a page, then carry on.
        const context = (handle as any)?.requireStagehand?.()?.context
        page = await ensureContextPage(context, target)
        if (process.env.ULTIMATRIX_BROWSER_TRACE) {
          const c: any = context
          console.log('[bt-provision] ' + JSON.stringify({
            ctx: !!c,
            ctxCtor: c?.constructor?.name,
            newPage: typeof c?.newPage,
            activePage: typeof c?.activePage,
            pages: typeof c?.pages,
            provisioned: !!page,
            pageGoto: typeof page?.goto,
          }))
        }
      }
      if (!page || typeof page.goto !== 'function') {
        await capture.stop()
        this.captureValue = undefined
        capture = undefined
        throw new Error('Browser provider did not expose a navigable page and could not open one')
      }
      await withTimeout(
        page.goto(target, { waitUntil: 'domcontentloaded', timeout: observationTimeoutMs }),
        observationTimeoutMs,
        'Target navigation',
      )
      if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(1000)
      const requests = await this.persistCapture(capture)
      if (requests === 0) throw new Error('Baseline observation captured zero network requests')
      const result = { requests, url: String(page.url?.() ?? target) }
      this.lastObservationState = { status: 'completed', result }
      return result
    } catch (error) {
      // Preserve any partial HAR even when navigation/provider startup fails;
      // the next model fallback must reuse this evidence rather than retrying
      // the browser and discarding the partial capture.
      if (capture) {
        try { await this.persistCapture(capture) } catch { /* preserve original failure */ }
      }
      const message = error instanceof Error ? error.message : String(error)
      this.lastObservationState = { status: 'failed', error: message }
      throw error
    }
  }

  private async crawlOnce(): Promise<SpiderRuntimeState> {
    const { target, config, workflow, runtime } = this.options
    if (!target || !workflow || !runtime) throw new Error('Crawl capability requires a target and workflow')
    if (this.options.memory && !this.options.identity) throw new Error('Crawl capability requires runtime identity when memory is enabled')
    const controller = new AbortController()
    this.crawlController = controller
    const browser = await this.ensureBrowser()
    const capture = await this.ensureCapture()
    const listener = this.onSpiderEvent
    try {
      const result = await runSpiderRuntime({
        config,
        target,
        browser,
        memory: this.options.memory,
        threadId: this.options.identity?.threadId,
        resourceId: this.options.identity?.resourceId,
        graphStore: runtime.graph,
        workflowId: workflow.state.workflowId,
        initialState: workflow.state.spider ? { ...workflow.state.spider } : undefined,
        signal: controller.signal,
        onEvent: (event) => {
          runtime.services.events.emit('spider:event' as any, event)
          listener?.(event)
        },
        allowAny: runtime.services.allowAny,
        approvedOrigins: this.options.approvedOrigins,
        onRuntime: this.onSpiderRuntime,
        onFinalize: async (state, outcome) => {
          workflow.attachSpider(state)
          await runtime.saveCheckpoint(`spider:${outcome.status}`)
          return `${workflow.state.workflowId}:${state.updatedAt}`
        },
      })
      await this.persistCapture(capture)
      if (result.outcome.status === 'failed') {
        throw new Error(result.outcome.error)
      }
      if (result.outcome.status === 'aborted') {
        throw new Error(result.outcome.reason)
      }
      this.lastCrawlState = result.state
      return result.state
    } finally {
      if (this.crawlController === controller) this.crawlController = undefined
    }
  }

  private lastCaptureRequests = 0

  private async persistCapture(capture: CaptureSession): Promise<number> {
    const runtime = this.options.runtime
    if (!runtime) return 0
    // Drain only completed entries. The capture subscriber remains attached so
    // browser actions after observation/crawl are captured as well.
    const drain = typeof (capture as CaptureSession).flush === 'function' ? capture.flush : capture.stop
    const har = await drain()
    if (!har) { this.lastCaptureRequests = 0; return 0 }
    try {
      this.lastCaptureRequests = JSON.parse(har)?.log?.entries?.length ?? 0
    } catch { this.lastCaptureRequests = 0 }
    const safe = redactHarJson(har)
    const directory = resolve(runtime.workspace.getTargetDir(this.options.target), 'captures')
    await mkdir(directory, { recursive: true })
    const path = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.har`)
    await writeFile(path, safe, 'utf8')
    runtime.artifacts.create('har', { path, initialStatus: 'redacted', provenance: [{ source: 'capture', ref: 'network-capture' }] })
    await bridgeHARToGraph(har, this.options.target)
    // C4/C5 â€” post-crawl discovery (shadow API + js-miner), non-fatal.
    try {
      const { runPostCrawlDiscovery } = await import('../discovery/post-crawl')
      await runPostCrawlDiscovery(this.options.target)
    } catch {
      /* discovery is best-effort */
    }
    return this.lastCaptureRequests
  }

  async ensureWorkers(): Promise<LazyWorkerServices> {
    if (this.workersValue) return this.workersValue
    if (this.workersPromise) return this.workersPromise
    this.workersPromise = (async () => {
      const workflow = this.options.workflow
      if (!workflow) throw new Error('Worker capability requires a target workflow')
      const workerPool = new WorkerPool(
        this.options.config,
        this.options.skillRegistry,
        this.browserValue,
        undefined,
        this.options.extensionRegistry,
      )
      const taskCoordinator = createWorkerTaskCoordinator(workflow, workerPool)
      await taskCoordinator.recoverInterrupted()
      return { workerPool, taskCoordinator }
    })().then(value => {
      this.workersValue = value
      return value
    }).finally(() => {
      this.workersPromise = undefined
    })
    return this.workersPromise
  }

  async ensureCouncil(blackboard: Blackboard): Promise<import('../council/factory').CouncilResources> {
    if (this.councilValue) return this.councilValue
    if (this.councilPromise) return this.councilPromise
    this.councilPromise = (async () => {
      const workers = await this.ensureWorkers()
      const { createCouncil } = await import('../council/factory')
      return createCouncil(this.options.config, {
        skillRegistry: this.options.skillRegistry,
        workerPool: workers.workerPool,
        taskCoordinator: workers.taskCoordinator,
        browser: this.browserValue,
        extensionRegistry: this.options.extensionRegistry,
      }, blackboard)
    })().then(value => {
      this.councilValue = value
      return value
    }).finally(() => {
      this.councilPromise = undefined
    })
    return this.councilPromise
  }

  get initialized(): { browser: boolean; capture: boolean; oast: boolean; workers: boolean; council: boolean } {
    return {
      browser: Boolean(this.browserValue),
      capture: Boolean(this.captureValue),
      oast: this.oastPort !== undefined,
      workers: Boolean(this.workersValue),
      council: Boolean(this.councilValue),
    }
  }

  get crawlState(): SpiderRuntimeState | undefined {
    return this.lastCrawlState
  }

  get observationState(): ObservationState | undefined {
    return this.lastObservationState
  }

  /** Deterministic research setup is engagement-scoped and must not rerun on
   * provider fallback turns. */
  get researchBootstrapState(): 'pending' | 'completed' {
    return this.researchBootstrapAttempted ? 'completed' : 'pending'
  }

  markResearchBootstrapAttempted(): void {
    this.researchBootstrapAttempted = true
  }

  async close(): Promise<void> {
    // Stop a roaming crawl first: after a turn timeout the spider would
    // otherwise keep driving target traffic detached from any session.
    this.abortCrawl('Session closing')
    if (this.captureValue) {
      try { await this.persistCapture(this.captureValue) } catch { /* final capture is best effort */ }
      try {
        const stop = typeof (this.captureValue as CaptureSession).stop === 'function'
          ? this.captureValue.stop
          : this.captureValue.handle.stop
        const finalHar = await stop()
        if (typeof finalHar === 'string' && finalHar) await bridgeHARToGraph(finalHar, this.options.target)
      } catch {}
    }
    this.captureValue = undefined
    this.options.runtime?.services.humanObserver.detach()
    if (this.capturePage) this.options.runtime?.services.passiveObserver.detach(this.capturePage)
    this.capturePage = undefined
    this.options.runtime?.services.dialogWatcher.detach()
    if (this.oastPort !== undefined) await stopOastServer(this.options.runtime?.oast)
    this.oastPort = undefined
  }
}
