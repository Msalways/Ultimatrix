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
import type { RuntimeIdentity } from './identity'

type CaptureSession = {
  stop: () => Promise<string | null>
  handle: CdpCaptureHandle | HarCapture
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
      // Bridge to BrowserManagerState so getActivePage()/getActiveBrowser() work
      this.options.runtime.services.browserManager.browser = session.browser
      this.options.runtime.services.browserManager.activeBrowser = session.browser
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
      // Phase A â€” provider-dispatched capture (no vendor sniffing).
      const { isCamofoxHandle } = await import('../browser/provider')
      if (isCamofoxHandle(browser)) {
        const { attachHarCaptureViaPlaywright } = await import('../session/playwright-network-capture')
        const handle = attachHarCaptureViaPlaywright(browser.context as any, {})
        capture = { handle, stop: async () => {
          const entries = await handle.stop()
          return entries.length ? JSON.stringify({ log: { version: '1.2', creator: { name: 'ultimatrix', version: '8.0.0' }, entries } }, null, 2) : null
        } }
        this.options.workflow?.setCaptureSource('cdp') // live in-session capture (playwright transport)
      } else {
        const stagehand = browser?.requireStagehand?.()
        if (stagehand?.context?.conn) {
          const handle = attachHarCaptureViaCdp(stagehand, { captureResponseBody: true, captureRequestBody: true })
          if (handle.attached) {
            capture = { handle, stop: async () => {
              const entries = await handle.stop()
              return entries.length ? JSON.stringify({ log: { version: '1.2', creator: { name: 'ultimatrix', version: '8.0.0' }, entries } }, null, 2) : null
            } }
            this.options.workflow?.setCaptureSource('cdp')
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
    const handle = await startHarCapture(this.options.target, ['localhost', '127.0.0.1'])
    this.options.workflow?.setCaptureSource('anonymous-fallback')
    return { handle, stop: handle.stop }
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
    this.crawlPromise = this.crawlOnce().finally(() => {
      this.crawlPromise = undefined
    })
    return this.crawlPromise
  }

  private async crawlOnce(): Promise<SpiderRuntimeState> {
    const { target, config, workflow, runtime } = this.options
    if (!target || !workflow || !runtime) throw new Error('Crawl capability requires a target and workflow')
    if (this.options.memory && !this.options.identity) throw new Error('Crawl capability requires runtime identity when memory is enabled')
    const browser = await this.ensureBrowser()
    const capture = await this.ensureCapture()
    const listener = this.onSpiderEvent
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
  }

  private async persistCapture(capture: CaptureSession): Promise<void> {
    const runtime = this.options.runtime
    if (!runtime) return
    const har = await capture.stop()
    this.captureValue = undefined
    if (!har) return
    const safe = redactHarJson(har)
    const directory = resolve(runtime.workspace.getTargetDir(this.options.target), 'captures')
    await mkdir(directory, { recursive: true })
    const path = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.har`)
    await writeFile(path, safe, 'utf8')
    runtime.artifacts.create('har', { path, initialStatus: 'redacted', provenance: [{ source: 'capture', ref: 'network-capture' }] })
    await bridgeHARToGraph(safe, this.options.target)
    // C4/C5 â€” post-crawl discovery (shadow API + js-miner), non-fatal.
    try {
      const { runPostCrawlDiscovery } = await import('../discovery/post-crawl')
      await runPostCrawlDiscovery(this.options.target)
    } catch {
      /* discovery is best-effort */
    }
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

  async close(): Promise<void> {
    if (this.captureValue) try { await this.captureValue.stop() } catch {}
    this.captureValue = undefined
    this.options.runtime?.services.humanObserver.detach()
    if (this.capturePage) this.options.runtime?.services.passiveObserver.detach(this.capturePage)
    this.capturePage = undefined
    this.options.runtime?.services.dialogWatcher.detach()
    if (this.oastPort !== undefined) await stopOastServer(this.options.runtime?.oast)
    this.oastPort = undefined
  }
}
