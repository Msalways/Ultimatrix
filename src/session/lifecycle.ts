/**
 * SessionLifecycle â€” Centralized lifecycle orchestration.
 *
 * Every resource is created in dependency order, validated after creation,
 * and registered for deterministic cleanup. Phase transitions enforce
 * prerequisites. Errors at any phase trigger reverse-order cleanup.
 */

import type { UltimatrixConfig } from '../config'
import { loadConfig } from '../config'
import { log } from '../utils/logger'
import { getGlobalWorkspace } from '../workspace'
import { getOrCreateBrowser, closeBrowser, getActivePage } from '../browser/manager'
import { startDialogWatcher, stopDialogWatcher } from '../browser/dialog-watcher'
import { getGlobalReactionObserver } from '../browser/reaction-observer'
import { emitBrowserHumanAction, emitSessionInit, emitSessionComplete, getGlobalEmitter } from '../events/emitter'
import { startOastServer, stopOastServer, setOastConfig } from '../oast/server'
import { createMemoryStore, createMemory } from '../workers/registry'
import { userInputEmitter, setReadlineInterface, uiGoalEmitter } from '../tools/interaction-tools'
import { detectChains } from '../intelligence/chaining'
import { finalizeEngagementMemory } from '../intelligence/cross-engagement'
import type { FindingNode } from '../graph/schema'
import { runSpiderRuntime, stableTargetId, type SpiderRuntimeEvent, type SpiderRuntimeState } from '../spider/runtime'
import { spiderEventLine } from '../spider/render'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { ForensicLog } from '../logging/forensic-log'
import { setForensicLog } from '../tools/report-tools'
import { setScopeConfig, setExternalToolsConfig, deriveScopeFromTarget, isAllowAny } from '../safety/scope-guard'
import { writeFile, mkdir } from 'node:fs/promises'
import { mkdirSync, existsSync } from 'node:fs'
import { Agent } from '@mastra/core/agent'
import { getGlobalObserver } from '../capture/human-observer'
import { SkillRegistry } from '../solver/skills/registry'
import { WorkerPool } from '../workers/pool'
import type { TaskCoordinator } from '../runtime/task-coordinator'
import { createEngagementRuntime, type EngagementRuntime } from '../runtime/engagement-runtime'
import type { Blackboard } from '../solver/blackboard'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import { LoopDetector } from '../intelligence/anti-loop'
import type { ReflexionEngine } from '../intelligence/reflexion'
import { resetAllProviderLimiters } from '../models/limiter-factory'
import { bridgeHARToGraph } from '../analysis/har-bridge'
import { startHarCapture, type HarCapture } from './har-capture'
import { attachHarCaptureViaCdp, type CdpCaptureHandle } from './cdp-network-capture'
import { redactHarJson } from '../security/secret-vault'
import { getGlobalArtifactRegistry, setArtifactCreateListener } from '../security/artifacts'
import { getGlobalDecisionLedger } from '../security/decision-ledger'
import { WorkflowStore, getWorkflowPath } from '../workflow/store'
import { getGlobalUsageTracker } from '../usage/tracker'
import { coreEvidenceLedger } from '../core/evidence'

/**
 * Unified capture session: the live CDP-backed capture (preferred) or the
 * standalone headless Playwright capture (fallback). Both expose a uniform
 * `stop()` that returns a HAR JSON string (or null).
 */
type HarCaptureSession = {
  kind: 'cdp'
  handle: CdpCaptureHandle
  stop: () => Promise<string | null>
} | {
  kind: 'headless'
  handle: HarCapture
  stop: () => Promise<string | null>
}
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { ModelSelector } from '../models/selector'
import type { CoreServices } from '../core/types'


// â”€â”€â”€ Phase type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type SessionPhase =
  | 'idle'
  | 'config'
  | 'resources'
  | 'browser'
  | 'infrastructure'
  | 'spider'
  | 'engine'
  | 'running'
  | 'done'

// â”€â”€â”€ Resources â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface SessionResources {
  config: UltimatrixConfig
  target: string
  workspace: ReturnType<typeof getGlobalWorkspace>
  memoryStore: Awaited<ReturnType<typeof createMemoryStore>>
  memory: Awaited<ReturnType<typeof createMemory>>
  browser: ReturnType<typeof getOrCreateBrowser>
  oastPort: number
  harCapture: HarCaptureSession | null
  /**
   * Legacy readline interface bound to `process.stdin`. NULL in console mode —
   * there Ink owns stdin in raw mode, so attaching a readline would create a
   * second stdin owner and the "typing goes to the terminal" bug. The console
   * path drives input via the Ink InputBar → `uiGoalEmitter`/`uiInputEmitter`
   * queues instead. This is the structural single-owner invariant.
   */
  readline: ReadlineInterface | null
  /** True when the Ink full-screen console owns the terminal (stdin + screen). */
  consoleMode: boolean
  /** Proposed origins the user pre-approved (CLI `--approve-origin`) before the crawl. */
  approvedOrigins: string[]
  /** Slice 02 — workflow-owned state (embeds spider, browser, refs). */
  workflow?: WorkflowStore
  forensicLog: ForensicLog
  threadId: string
  resourceId: string

  // Engine-specific
  solverBrain?: Agent
  supervisor?: any
  workers?: any
  skillRegistry?: SkillRegistry
  workerPool?: WorkerPool
  taskCoordinator?: TaskCoordinator
  extensionRegistry?: import('../extensions/tool-registry').DynamicToolRegistry
  sessionBlackboard?: Blackboard
  sessionEvidence?: EvidenceGate
  sessionLoopDetector?: LoopDetector
  sessionReflexion?: ReflexionEngine
  harContextForLLM?: string
  modelSelector?: ModelSelector
  council?: import('../council/factory').CouncilResources
  /** Debate memory — accumulates stances across REPL turns. */
  debateMemory?: import('../council/types').DebateMemory
  /** B3: Prior council execution results, carried turn→turn for results debate. */
  councilPreviousResults?: string
  /** T3.3: Unified CoreServices — built once in setupEngine(), consumed by runner/session. */
  coreServices?: CoreServices
  lazyServices?: import('../runtime/lazy-services').LazySolverServices
  /** Logical tenant namespace for worker isolation. */
  tenant?: string
  /** Logical sandbox namespace for worker isolation. */
  sandboxId?: string
}

// â”€â”€â”€ Lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class SessionLifecycle {
  private phase: SessionPhase = 'idle'
  private _resources: Partial<SessionResources> = {}
  private cleanupFns: Array<() => Promise<void>> = []
  private runtime?: EngagementRuntime
  private shuttingDown = false

  get resources(): Readonly<Partial<SessionResources>> {
    return this._resources
  }

  get currentPhase(): SessionPhase {
    return this.phase
  }

  // â”€â”€ Phase 0: Config + Resources â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async init(targetUrl?: string, opts: { consoleMode?: boolean; approvedOrigins?: string[] } = {}): Promise<SessionResources> {
    this.assertPhase('idle')
    const consoleMode = Boolean(opts.consoleMode)
    const approvedOrigins = opts.approvedOrigins ?? []

    // Clear any stale limiter state from previous sessions
    resetAllProviderLimiters()

    const config = loadConfig()
    if (targetUrl) config.target = targetUrl

    const target = config.target || ''
    if (target) {
      this.runtime = await createEngagementRuntime(config, target)
      return this.runtime.run(() => this.initConfigured(config, target, consoleMode, approvedOrigins))
    }
    return this.initConfigured(config, target, consoleMode, approvedOrigins)
  }

  private async initConfigured(
    config: UltimatrixConfig,
    target: string,
    consoleMode: boolean,
    approvedOrigins: string[],
  ): Promise<SessionResources> {
    const workspace = this.runtime?.workspace ?? getGlobalWorkspace()
    const threadBase = target
      ? `ultimatrix-${target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
      : 'ultimatrix'
    const resourceId = 'ultimatrix'

    // Per-target DB path
    if (target) {
      const dir = workspace.getTargetDir(target)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    }
    const dbPath = target
      ? resolve(workspace.getTargetDir(target), 'ultimatrix.db')
      : undefined

    const memoryStore = await createMemoryStore(dbPath)
    const memory = await createMemory(config, memoryStore, dbPath, { mainAgent: config.engine !== 'legacy' })

    // Thread resumption
    const { threads: existingThreads } = await memory.listThreads({ filter: { resourceId } })
    const targetThread = existingThreads.find((t: any) => t.id.startsWith(threadBase))
    const threadId = targetThread?.id || threadBase

    if (targetThread) {
      log.info(`Resuming existing session: ${threadId}`)
    } else if (target) {
      await memory.saveThread({
        thread: {
          id: threadId,
          title: `Ultimatrix â€” ${target}`,
          resourceId,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { targetUrl: target },
        },
      })
    }

    if (target && !this.runtime) {
      await workspace.switchTarget(target)
    }

    // Slice 02 — workflow-owned state. Load a persisted snapshot if one exists
    // for this target, otherwise create + persist a fresh one. The workflowId
    // is the stable identity for crawl/evidence/artifact references — never the
    // target slug. Artifact creation is folded into the workflow via the typed
    // listener; the decision ledger is tagged so decisions carry the workflowId.
    let workflow: WorkflowStore | undefined
    if (target) {
      workflow = this.runtime?.workflow ?? await WorkflowStore.loadOrCreate(getWorkflowPath(target), { target, browserProvider: config.browser.provider })
      getGlobalArtifactRegistry().setWorkflowId(workflow.state.workflowId)
      setArtifactCreateListener((record) => {
        workflow?.recordArtifact(record)
      })
      getGlobalDecisionLedger().setWorkflowId(workflow.state.workflowId)
    }
    this._resources.workflow = workflow

    // Forensic log
    const forensicLogPath = resolve(workspace.getTargetDir(target || '.'), 'forensic.ndjson')
    const forensicLog = this.runtime?.forensicLog ?? new ForensicLog(forensicLogPath)
    setForensicLog(forensicLog)

    this._resources.config = config
    this._resources.target = target
    this._resources.workspace = workspace
    this._resources.memoryStore = memoryStore
    this._resources.memory = memory
    this._resources.threadId = threadId
    this._resources.resourceId = resourceId
    this._resources.forensicLog = forensicLog
    this._resources.consoleMode = consoleMode
    this._resources.approvedOrigins = approvedOrigins

    // Activate scope guard from config.
    // If no explicit scope, derive one from config.target so tools are not
    // hard-rejected out of the box.
    const scopeConfig = config.scope ?? (config.target ? deriveScopeFromTarget(config.target) : null)
    setScopeConfig(scopeConfig)
    // External-tool policy is opt-in only (deny by default) — ambient for the
    // adapter chokepoint in buildAdapterTool.
    setExternalToolsConfig(config.externalTools ?? null)

    this.registerCleanup(async () => {
      log.dim('Saving graph and OAST state...')
      await Promise.all([
        workspace.getGraphStore()?.save(),
        workspace.getOastStore()?.save(),
      ])
    })

    this.registerCleanup(async () => {
      const wf = this._resources.workflow
      if (!wf) return
      // Final snapshot of this workflow: fold session-scoped evidence and usage,
      // mark it completed, and persist so a future session can resume it.
      wf.syncEvidence(coreEvidenceLedger.all())
      wf.syncModelUsage(getGlobalUsageTracker().getEntries())
      if (wf.state.status === 'running') wf.setStatus('completed')
      await wf.save()
    })

    // Finalize cross-engagement memory (anonymized structural features only)
    // so future sessions on the same target-origin can reuse technique priors.
    // Runs at cleanup regardless of how the session ended.
    const targetOrigin = target ? new URL(target).origin : ''
    this.registerCleanup(async () => {
      if (!targetOrigin) return
      try {
        const store = workspace.getGraphStore()
        if (store) await finalizeEngagementMemory(store, targetOrigin)
      } catch (err) {
        log.dim(`Cross-engagement finalize skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
    })

    this.phase = 'config'
    log.info(`Target: ${target || '(none)'}`)

    // Start only the interactive control plane. The solver activates expensive
    // capabilities through its registry when they are actually needed.
    await this.startInput()

    // The unified solver is part of the cold control plane. It has metadata and
    // memory, but no browser, capture, crawler, workers, connectors, or council.
    if (config.engine !== 'legacy') await this.setupEngine()

    emitSessionInit(target || '', 'solver', config.model, [])
    return this._resources as SessionResources
  }

  private async startInput(): Promise<void> {
    this.assertPhase('config')

    if (this._resources.consoleMode) {
      this._resources.readline = null
    } else {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
      setReadlineInterface(rl)
      this._resources.readline = rl
      this.registerCleanup(async () => { rl.close() })

      const onAskUser = (question: string) => {
        process.stdout.write('\n' + question + ' ')
        rl.once('line', (answer: string) => userInputEmitter.emit('askUser-response', answer))
      }
      userInputEmitter.on('askUser-question', onAskUser)
      this.registerCleanup(async () => { userInputEmitter.removeListener('askUser-question', onAskUser) })
    }

    this.setupSIGINT()
    this.phase = 'resources'
  }

  /** @deprecated Legacy-only eager initialization path. */
  async ensureResearchReady(): Promise<void> {
    if (this.phase === 'engine') return
    this.assertPhase('resources')
    if (!this._resources.target) throw new Error('Research requires a target URL.')
    await this.launchBrowser()
    await this.startInfrastructure()
    await this.runSpider()
    await this.setupEngine()
  }

  // â”€â”€ Phase 1: Browser (with validation) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async launchBrowser(): Promise<void> {
    this.assertPhase('resources')
    const { config, target } = this._resources as { config: UltimatrixConfig; target: string }

    const [browser, oastPort] = await Promise.all([
      this.runtime ? this.runtime.startBrowser().then(session => session.browser) : (async () => {
        const b = getOrCreateBrowser(config)
        await b.ensureReady()
        return b
      })(),
      (setOastConfig(config.oast ?? null), startOastServer(0, this.runtime?.oast)),
    ])

    // Validate CDP connection works
    await this.validateBrowser(browser)

    // NOW start dialog watcher â€” browser is fully ready
    startDialogWatcher(browser)

    // Programmatic navigation â€” establish initial state before spider LLM runs
    // The entire downstream system (human observer, spider, dialog watcher) assumes
    // the browser is at the target URL. This ensures that precondition is always true.
    if (target) {
      const page = this.runtime
        ? await this.runtime.browser.getActivePage(this.runtime.browserSession!.sessionId) as any
        : getActivePage()
      if (page) {
        try {
          log.info(`Navigating to ${target}...`)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const status = response?.status() || 'unknown'
          const title = await page.title().catch(() => '')
          log.info(`Loaded ${target} â€” status: ${status}, title: "${title}"`)
        } catch (err) {
          log.warn(`Initial navigation failed: ${err instanceof Error ? err.message : String(err)}`)
          log.info('Spider will attempt navigation via browser tools.')
        }
      }
    }

    this._resources.browser = browser as any
    this._resources.oastPort = oastPort

    // Slice 02/05 + Phase A - record session id + provider on the workflow.
    const browserSessionId = browser && typeof (browser as any).id !== 'undefined'
      ? String((browser as any).id)
      : `camofox-${stableTargetId(target ?? '')}`
    if (browser) {
      const workflow = this._resources.workflow
      if (workflow) {
        workflow.setBrowserSessionId(browserSessionId)
        workflow.setBrowserProvider(config.browser.provider ?? 'stagehand')
        await workflow.save()
      }
    }

    this.registerCleanup(async () => {
      log.dim('Stopping OAST server...')
      await stopOastServer(this.runtime?.oast)
    })

    this.registerCleanup(async () => {
      log.dim('Closing browser...')
      stopDialogWatcher()
      try { getGlobalReactionObserver().detach() } catch {}
      if (!this.runtime) await closeBrowser()
    })

    // Self-evolution (spec 05): fold this engagement into anonymized
    // cross-session memory — the loop that was designed but never fired.
    this.registerCleanup(async () => {
      try {
        const { finalizeEngagementMemory } = await import('../intelligence/cross-engagement')
        const store = getGlobalWorkspace().getGraphStore()
        if (store && target) {
          await finalizeEngagementMemory(store, target)
          log.dim('[evolution] Engagement summary recorded to cross-session memory')
        }
      } catch (err) {
        log.dim('[evolution] Engagement memory failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)))
      }
      try {
        const { synthesizeDraftSkills } = await import('../intelligence/draft-skills')
        const store = getGlobalWorkspace().getGraphStore()
        if (store && target) {
          const draftsDir = resolve(getGlobalWorkspace().getTargetDir(target), 'skills-drafts')
          const drafts = await synthesizeDraftSkills(store, draftsDir)
          for (const d of drafts.created) {
            log.warn(`[evolution] Draft skill synthesized: ${d.skillPath} (unvalidated — review to promote)`)
          }
        }
      } catch (err) {
        log.dim('[evolution] Draft synthesis failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)))
      }
    })

    this.phase = 'browser'
    log.info(`OAST server started on port ${oastPort}`)
  }

  private async validateBrowser(_browser: any): Promise<void> {
    const page = this.runtime
      ? await this.runtime.browser.getActivePage(this.runtime.browserSession!.sessionId) as any
      : getActivePage()
    if (!page) {
      throw new Error('Browser validation failed: no active page after ensureReady()')
    }
    try {
      await page.evaluate(() => document.readyState)
    } catch (err) {
      throw new Error(`Browser validation failed: page not responsive — ${err instanceof Error ? err.message : String(err)}`, { cause: err })
    }
  }

  // â”€â”€ Phase 2: Infrastructure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async startInfrastructure(): Promise<void> {
    this.assertPhase('browser')
    const { config, target, forensicLog, browser } = this._resources as SessionResources

    // Human observer â€” deferred 3s for browser to settle
    const observer = getGlobalObserver()
    const attachObserver = async () => {
      const page = this.runtime
        ? await this.runtime.browser.getActivePage(this.runtime.browserSession!.sessionId) as any
        : getActivePage()
      if (page && !observer.isCapturing()) {
        observer.attach(page)
        observer.onAction((action) => {
          emitBrowserHumanAction(action.type, action.url, action.selector)
          forensicLog.log({
            type: 'human-action',
            agent: 'human',
            args: { type: action.type, selector: action.selector, url: action.url, value: action.value },
          })
        })
        log.dim('Human action capture active')
      }
    }
    setTimeout(() => { void attachObserver() }, 3000)

    if (!config.browser.headless) {
      log.info('Browser is visible â€” interact with it directly')
      log.info('   The agent captures your actions automatically')
    } else {
      log.dim('Browser is headless (set HEADLESS=false to see it)')
    }

    // HAR capture — prefer the live CDP-backed capture (human + spider + agent
    // in one listener). Fall back to standalone headless capture only when no
    // Stagehand context exists (e.g. headless `solve`).
    let harCapture: HarCaptureSession | null = null
    if (target) {
      // Phase A — provider-dispatched capture (no vendor sniffing).
      const { isCamofoxHandle } = await import('../browser/provider')
      if (isCamofoxHandle(browser)) {
        const { attachHarCaptureViaPlaywright } = await import('../session/playwright-network-capture')
        const handle = attachHarCaptureViaPlaywright((browser as any).context as any, {})
        harCapture = {
          kind: 'cdp',
          handle,
          stop: async () => {
            const entries = await handle.stop()
            if (entries.length === 0) return null
            const archive = { log: { version: '1.2', creator: { name: 'ultimatrix', version: '8.0.0' }, entries } }
            return JSON.stringify(archive, null, 2)
          },
        }
        log.info('Live Playwright HAR capture attached (camofox)')
        this._resources.workflow?.setCaptureSource('cdp')
      } else {
        const stagehand = (browser as any)?.requireStagehand?.()
        if (stagehand?.context?.conn) {
          const handle = attachHarCaptureViaCdp(stagehand, {
            captureResponseBody: true,
            captureRequestBody: true,
          })
          if (handle.attached) {
            harCapture = {
              kind: 'cdp',
              handle,
              stop: async () => {
                const entries = await handle.stop()
                if (entries.length === 0) return null
                const archive = { log: { version: '1.2', creator: { name: 'ultimatrix', version: '8.0.0' }, entries } }
                return JSON.stringify(archive, null, 2)
              },
            }
            log.info('Live CDP HAR capture attached')
            this._resources.workflow?.setCaptureSource('cdp')
          }
        }
      }
      if (!harCapture) {
        try {
          const headless = await startHarCapture(target, ['localhost', '127.0.0.1'])
          harCapture = { kind: 'headless', handle: headless, stop: headless.stop }
          this._resources.workflow?.setCaptureSource('anonymous-fallback')
          log.info('HAR capture started (headless fallback — anonymous session, labeled captureSource=anonymous-fallback)')
        } catch (err) {
          log.dim('HAR capture unavailable: ' + (err instanceof Error ? err.message : String(err)))
        }
      }
    }
    this._resources.harCapture = harCapture

    if (harCapture) {
      this.registerCleanup(async () => {
        log.dim('Stopping HAR capture...')
        try { await harCapture!.stop() } catch {}
      })
    }

    this.phase = 'infrastructure'
  }

  // â”€â”€ Phase 3: Spider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async runSpider(): Promise<void> {
    if (this.runtime) return this.runtime.run(() => this.runSpiderOwned())
    return this.runSpiderOwned()
  }

  private async runSpiderOwned(): Promise<void> {
    this.assertPhase('infrastructure')
    const { config, target, browser, memory, threadId, resourceId } = this._resources as SessionResources

    if (!target) {
      this.phase = 'spider'
      return
    }

    // Spider can be explicitly disabled via config (e.g., for council-only sessions
    // where the user provides context manually, or to skip a slow/static target).
    if (config.spider?.enabled === false) {
      log.info('Spider disabled by config — skipping crawl')
      this.phase = 'spider'
      return
    }

    const workspace = this._resources.workspace!

    // Check existing crawl data
    await workspace.getGraphStore()?.load()
    const existingSummary = workspace.getGraphStore()?.getTargetSummary()

    if (existingSummary && existingSummary.totalEndpoints > 0) {
      log.info(`Graph already has ${existingSummary.totalEndpoints} endpoints, ${existingSummary.totalFindings} findings for this target.`)
    }

    log.info('Crawling ' + target + '...')

    const workflow = this._resources.workflow
    const spiderWorkflowId = workflow?.state.workflowId ?? `workflow-${stableTargetId(target)}`
    // Slice 10 — CLI renders the full typed spider:event stream through the
    // shared renderer (same output as the Web UI). Scoped by workflowId so a
    // concurrent web crawl never leaks into the CLI.
    const onSpiderEvent = (event: SpiderRuntimeEvent): void => {
      if (event.workflowId !== spiderWorkflowId) return
      log.dim(spiderEventLine(event))
    }
    getGlobalEmitter().on('spider:event', onSpiderEvent)
    let spiderState: SpiderRuntimeState | undefined
    try {
      const spiderResult = await runSpiderRuntime({
        config,
        target,
        browser,
        memory,
        threadId,
        resourceId,
        graphStore: workspace.getGraphStore() as any,
        workflowId: workflow?.state.workflowId ?? undefined,
        initialState: workflow?.state.spider ? { ...workflow.state.spider } : undefined,
        allowAny: isAllowAny(),
        approvedOrigins: (this._resources as SessionResources).approvedOrigins,
        onText: (text) => process.stdout.write(text),
        onFinalize: async (state, outcome) => {
          workflow?.attachSpider(state)
          if (this.runtime) await this.runtime.saveCheckpoint(`spider:${outcome.status}`)
          else await workflow?.save()
          return `${spiderWorkflowId}:${state.updatedAt}`
        },
      })
      spiderState = spiderResult.state
    } finally {
      getGlobalEmitter().off('spider:event', onSpiderEvent)
    }

    // Slice 02 — attach the crawl snapshot to the workflow and persist. This is
    // what makes resume possible: the spider state (and stop reason) are carried
    // forward, not re-discovered from target-keyed globals.
    const finalSummary = workspace.getGraphStore()?.getTargetSummary()
    if (finalSummary) {
      log.dim(`[Spider] Crawl complete (${spiderState.stopReason ?? 'unknown'}) - Final summary: ${finalSummary.totalEndpoints} endpoints, ${finalSummary.totalPages} pages, ${finalSummary.totalFindings} findings`)
      if (finalSummary.totalEndpoints === 0) log.warn('[Spider] Warning: No endpoints discovered - navigation may have failed')
      if (finalSummary.totalPages === 0) log.warn('[Spider] Warning: No pages recorded - page recording may be failing')
    }

    // HAR bridge
    const harCapture = this._resources.harCapture
    if (harCapture) {
      try {
        const harJson = await harCapture.stop()
        if (harJson) {
          const safeHarJson = redactHarJson(harJson)
          const capturesDir = resolve(workspace.getTargetDir(target), 'captures')
          await mkdir(capturesDir, { recursive: true })
          const harPath = resolve(capturesDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.har`)
          await writeFile(harPath, safeHarJson, 'utf-8')
          log.success('HAR saved: ' + harPath)
          getGlobalArtifactRegistry().create('har', {
            path: harPath,
            initialStatus: 'redacted',
            provenance: [{ source: 'capture', ref: 'network-capture' }],
          })

          try {
            const bridgeResult = await bridgeHARToGraph(safeHarJson, target)
            if (bridgeResult.contextForLLM) {
              this._resources.harContextForLLM = bridgeResult.contextForLLM
              log.success(`HAR bridge: ${bridgeResult.endpointsWritten} endpoints, ${bridgeResult.secretsWritten} secrets, ${bridgeResult.factsWritten} facts, ${bridgeResult.hypothesesGenerated} hypotheses â†’ graph`)
            }
          } catch (err) {
            log.dim('HAR bridge failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)))
          }
        } else {
          log.dim('No HAR entries captured')
        }
      } catch (err) {
        log.error('HAR save failed: ' + (err instanceof Error ? err.message : String(err)))
      }
      this._resources.harCapture = null
    }

    // C4/C5 — post-crawl discovery: shadow API probes + js-miner over captured
    // bodies. Non-fatal; everything routes through scope-guarded seams.
    try {
      const { runPostCrawlDiscovery } = await import('../discovery/post-crawl')
      const discovery = await runPostCrawlDiscovery(target)
      if (discovery.shadowEndpoints + discovery.jsCandidates > 0) {
        log.success(`Post-crawl discovery: ${discovery.shadowEndpoints} shadow endpoints, ${discovery.jsCandidates} js-mined candidates`)
      }
      for (const err of discovery.errors) log.dim(`[post-crawl] ${err}`)
    } catch (err) {
      log.dim('Post-crawl discovery failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)))
    }

    this.phase = 'spider'
  }

  // â”€â”€ Phase 4: Engine setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async setupEngine(): Promise<void> {
    if (this.runtime) return this.runtime.run(() => this.setupEngineOwned())
    return this.setupEngineOwned()
  }

  private async setupEngineOwned(): Promise<void> {
    const config = this._resources.config!
    if (config.engine === 'legacy') this.assertPhase('spider')
    else if (this.phase !== 'resources') throw new Error(`Invalid lifecycle phase: expected resources, got ${this.phase}`)
    const { browser, memory, target, harContextForLLM, threadId, resourceId } = this._resources as SessionResources

    const { createEngineServices } = await import('./engine-setup')
    const engine = await createEngineServices({
      config,
      browser,
      memory,
      target,
      identity: {
        threadId,
        resourceId,
        workflowId: this._resources.workflow?.state.workflowId ?? resourceId,
        target,
      },
      harContextForLLM,
      workflow: this._resources.workflow,
      runtime: this.runtime,
      approvedOrigins: this._resources.approvedOrigins,
    })

    // Transfer engine services into lifecycle resources
    Object.assign(this._resources, {
      solverBrain: engine.solverBrain,
      supervisor: engine.supervisor,
      workers: engine.workers,
      skillRegistry: engine.skillRegistry,
      workerPool: engine.workerPool,
      taskCoordinator: engine.taskCoordinator,
      sessionBlackboard: engine.sessionBlackboard,
      sessionEvidence: engine.sessionEvidence,
      sessionLoopDetector: engine.sessionLoopDetector,
      sessionReflexion: engine.sessionReflexion,
      coreServices: engine.coreServices,
      modelSelector: engine.modelSelector,
      council: engine.council,
      extensionRegistry: engine.extensionRegistry,
      lazyServices: engine.lazyServices,
    })

    if (engine.extensionRegistry) {
      this.registerCleanup(() => engine.extensionRegistry!.closeAll())
    }
    if (engine.lazyServices) this.registerCleanup(() => engine.lazyServices!.close())

    const useSolver = config.engine !== 'legacy'
    log.info(useSolver ? 'Solver engine ready with lazy capability catalog' : 'Legacy engine ready')

    if (config.modelTiers) {
      const tierMap = config.modelTiers
      const tierLines = ['fast', 'balanced', 'powerful']
        .filter(t => tierMap[t as keyof typeof tierMap])
        .map(t => {
          const cfg = tierMap[t as keyof typeof tierMap]!
          return `  ${t}: ${cfg.provider}/${cfg.model}`
        })
        .join('\n')
      if (tierLines) log.info(`Model tiers:\n${tierLines}`)
    }

    this.phase = 'engine'
  }

  // â”€â”€ Phase 5: REPL loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async runREPL(onInput: (line: string) => Promise<void | boolean>): Promise<void> {
    if (this.runtime) return this.runtime.run(() => this.runREPLOwned(onInput))
    return this.runREPLOwned(onInput)
  }

  private async runREPLOwned(onInput: (line: string) => Promise<void | boolean>): Promise<void> {
    if (this.phase !== 'resources' && this.phase !== 'engine') {
      throw new Error(`Invalid lifecycle phase: expected resources or engine, got ${this.phase}`)
    }

    const { config, target, oastPort, readline: rl, consoleMode } = this._resources as SessionResources
    const useSolver = config.engine !== 'legacy'

    // Structural invariant: in console mode Ink owns stdin, so NO readline may
    // be bound to process.stdin. If this fails, the single-owner contract is
    // broken and "typing goes to the terminal" returns. Fail fast.
    if (consoleMode && rl !== null) {
      throw new Error('Console mode requires readline to be null (Ink must own stdin).')
    }

    log.banner(
      'Ultimatrix v8',
      'Model: ' + config.provider + '/' + config.model + (target ? '  |  Target: ' + target : '') + `  |  OAST: ${oastPort ? `:${oastPort}` : 'deferred'}` + (useSolver ? `  |  Engine: ${config.engine}` : '  |  Engine: legacy'),
    )

    if (!target) {
      log.info('No target set. Tell me a URL to investigate.')
    }

    log.nl()
    log.dim(useSolver
      ? `Entering interactive mode (${config.engine} engine). Type your goal or /council <goal> or Ctrl+C to exit.`
      : 'Entering interactive mode. Type your message or Ctrl+C to exit.')
    log.nl()

    try {
      for (;;) {
        let promptTarget = 'no-target'
        if (target) {
          try { promptTarget = new URL(target).hostname } catch { promptTarget = target }
        }
        process.stdout.write(`${promptTarget}> `)
        // Console mode: Ink owns stdin. The REPL consumes goals from the
        // `uiGoalEmitter` queue (fed by the Ink InputBar) — NO readline
        // listener, so there is exactly one owner of stdin. Non-console mode
        // keeps the legacy readline `getLine` (reversible).
        // In non-console mode rl is guaranteed non-null (readline was attached).
        const line = consoleMode ? await getConsoleLine() : await getLine(rl!)
        if (line === null) break
        if (!line.trim()) continue

        try {
          process.stdout.write('\n')
          const shouldContinue = await onInput(line)
          if (shouldContinue === false) break
        } catch (err) {
          process.stdout.write('\n')
          log.error(err instanceof Error ? err.message : String(err))
        }
        process.stdout.write('\n')
      }
    } finally {
      await this.cleanup()
    }
  }

  // â”€â”€ Chain detection (called after each REPL turn) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  detectAndReportChains(): void {
    if (this.runtime) return this.runtime.run(() => this.detectAndReportChainsOwned())
    return this.detectAndReportChainsOwned()
  }

  private detectAndReportChainsOwned(): void {
    const graph = this._resources.workspace?.getGraphStore()
    if (!graph) return

    const allNodes = graph.queryNodes()
    const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]
    if (findings.length > 0) {
      const chains = detectChains(findings)
      for (const chain of chains) {
        log.info('Chain detected: ' + chain.rule.name + ' â€” ' + chain.source.properties.technique + ' â†’ ' + chain.target.properties.technique + ' (' + chain.rule.severity + ')')
        this._resources.sessionBlackboard?.addFact(
          `Chain detected: ${chain.source.properties.technique} â†’ ${chain.target.properties.technique} (${chain.rule.description}) [severity=${chain.rule.severity}]`,
          'chain',
        )
      }
    }
  }

  // â”€â”€ Cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async cleanup(): Promise<void> {
    if (this.runtime) return this.runtime.run(() => this.cleanupOwned())
    return this.cleanupOwned()
  }

  private async cleanupOwned(): Promise<void> {
    if (this.phase === 'done') return
    this.phase = 'done'

    emitSessionComplete(0, 0, 0, 0)
    log.info('Shutting down gracefully...')

    // Run cleanups in reverse order (LIFO)
    for (const fn of this.cleanupFns.reverse()) {
      try {
        await fn()
      } catch (err) {
        log.dim(`Cleanup error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (this.runtime) await this.runtime.close({ status: 'completed' })

    this.printSummary()
  }

  private registerCleanup(fn: () => Promise<void>): void {
    this.cleanupFns.push(fn)
  }

  // â”€â”€ SIGINT handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private setupSIGINT(): void {
    process.on('SIGINT', async () => {
      if (this.shuttingDown) {
        log.info('Forced exit.')
        process.exit(1)
      }
      this.shuttingDown = true
      process.stdout.write('\n')
      await this.cleanup()
      process.exit(0)
    })
  }

  // â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private printSummary(): void {
    const graph = this._resources.workspace?.getGraphStore()
    if (!graph) return

    const summary = graph.getTargetSummary()
    log.nl()
    log.info('=== Session Summary ===')
    if (this._resources.target) log.info(`Target: ${this._resources.target}`)
    log.info(`Endpoints: ${summary.totalEndpoints} (${summary.totalCapturedHeaders} with headers)`)
    const findings = Object.entries(summary.findingsBySeverity).filter(([, c]) => c > 0)
    log.info(`Findings: ${findings.map(([s, c]) => `${s}=${c}`).join(', ') || 'none'}`)
    log.info(`Auth flows: ${summary.authFlows} | RBAC roles: ${summary.rbacRoles}`)
    log.info(`Untested actions: ${summary.untestedActions}`)
  }

  // â”€â”€ Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private assertPhase(expected: SessionPhase): void {
    if (this.phase !== expected) {
      throw new Error(`Lifecycle: expected phase '${expected}', got '${this.phase}'`)
    }
  }
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getLine(rl: ReadlineInterface): Promise<string | null> {
  return new Promise(resolve => {
    const onLine = (line: string) => {
      rl.removeListener('close', onClose)
      uiGoalEmitter.removeListener('goal', onGoal)
      resolve(line)
    }
    const onClose = () => {
      rl.removeListener('line', onLine)
      uiGoalEmitter.removeListener('goal', onGoal)
      resolve(null)
    }
    const onGoal = (line: string) => {
      rl.removeListener('line', onLine)
      rl.removeListener('close', onClose)
      resolve(line)
    }
    rl.once('line', onLine)
    rl.once('close', onClose)
    uiGoalEmitter.once('goal', onGoal)
  })
}

/**
 * Console-mode input source. Resolves ONLY from the Ink InputBar via
 * `uiGoalEmitter` — it never attaches a readline listener, so `process.stdin`
 * has exactly one owner (Ink) in console mode. This is the structural fix for
 * the "typing goes to the terminal" bug: the legacy `getLine` races readline
 * AND the emitter, keeping readline alive on stdin. Here readline is absent.
 * Exported for unit testing the single-owner invariant (no readline listener).
 */
export function getConsoleLine(): Promise<string | null> {
  return new Promise((resolve) => {
    const onGoal = (line: string) => {
      uiGoalEmitter.removeListener('goal', onGoal)
      resolve(line)
    }
    uiGoalEmitter.once('goal', onGoal)
  })
}

