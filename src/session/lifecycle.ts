/**
 * SessionLifecycle — Centralized lifecycle orchestration.
 *
 * Every resource is created in dependency order, validated after creation,
 * and registered for deterministic cleanup. Phase transitions enforce
 * prerequisites. Errors at any phase trigger reverse-order cleanup.
 */

import type { UltimatrixConfig } from '../config'
import { DEFAULTS, loadConfig } from '../config'
import { log } from '../utils/logger'
import { getGlobalWorkspace } from '../workspace'
import { getOrCreateBrowser, closeBrowser, getActivePage } from '../browser/manager'
import { startDialogWatcher, stopDialogWatcher } from '../browser/dialog-watcher'
import { getGlobalReactionObserver } from '../browser/reaction-observer'
import { startOastServer, stopOastServer } from '../oast/server'
import { createAllWorkers, createMemoryStore, createMemory } from '../workers/registry'
import { userInputEmitter, setReadlineInterface } from '../tools/interaction-tools'
import { detectChains } from '../intelligence/chaining'
import type { FindingNode } from '../graph/schema'
import { NodeType } from '../graph/schema'
import { createSpiderAgent } from '../spider/agent'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { ForensicLog } from '../logging/forensic-log'
import { setForensicLog } from '../tools/report-tools'
import { setScopeConfig } from '../safety/scope-guard'
import { writeFile, mkdir } from 'node:fs/promises'
import { mkdirSync, existsSync } from 'node:fs'
import { Agent } from '@mastra/core/agent'
import { createSolverBrain } from '../solver/brain-tools'
import { solve } from '../solver/solver'
import { Blackboard } from '../solver/blackboard'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { LoopDetector } from '../intelligence/anti-loop'
import { ReflexionEngine } from '../intelligence/reflexion'
import { getGlobalObserver } from '../capture/human-observer'
import { SkillRegistry } from '../solver/skills/registry'
import { WorkerPool } from '../workers/pool'
import { resetAllProviderLimiters } from '../models/limiter-factory'
import { bridgeHARToGraph } from '../analysis/har-bridge'
import { startHarCapture, type HarCapture } from './har-capture'
import type { ReadlineInterface } from 'node:readline'

const internalTools = new Set(['updateWorkingMemory', 'setWorkingMemory'])

// ─── Phase type ────────────────────────────────────────────────────

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

// ─── Resources ─────────────────────────────────────────────────────

export interface SessionResources {
  config: UltimatrixConfig
  target: string
  workspace: ReturnType<typeof getGlobalWorkspace>
  memoryStore: Awaited<ReturnType<typeof createMemoryStore>>
  memory: Awaited<ReturnType<typeof createMemory>>
  browser: ReturnType<typeof getOrCreateBrowser>
  oastPort: number
  harCapture: HarCapture | null
  readline: ReadlineInterface
  forensicLog: ForensicLog
  threadId: string
  resourceId: string

  // Engine-specific
  solverBrain?: Agent
  supervisor?: any
  workers?: any
  skillRegistry?: SkillRegistry
  workerPool?: WorkerPool
  sessionBlackboard?: Blackboard
  sessionEvidence?: EvidenceGate
  sessionLoopDetector?: LoopDetector
  sessionReflexion?: ReflexionEngine
  harContextForLLM?: string
}

// ─── Lifecycle ─────────────────────────────────────────────────────

export class SessionLifecycle {
  private phase: SessionPhase = 'idle'
  private _resources: Partial<SessionResources> = {}
  private cleanupFns: Array<() => Promise<void>> = []
  private shuttingDown = false

  get resources(): Readonly<Partial<SessionResources>> {
    return this._resources
  }

  get currentPhase(): SessionPhase {
    return this.phase
  }

  // ── Phase 0: Config + Resources ──────────────────────────────────

  async init(targetUrl?: string): Promise<SessionResources> {
    this.assertPhase('idle')

    // Clear any stale limiter state from previous sessions
    resetAllProviderLimiters()

    const config = loadConfig()
    if (targetUrl) config.target = targetUrl

    const target = config.target || ''
    const workspace = getGlobalWorkspace()
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
    const memory = await createMemory(config, memoryStore, dbPath)

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
          title: `Ultimatrix — ${target}`,
          resourceId,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { targetUrl: target },
        },
      })
    }

    if (target) {
      await workspace.switchTarget(target)
    }

    // Forensic log
    const forensicLogPath = resolve(workspace.getTargetDir(target || '.'), 'forensic.ndjson')
    const forensicLog = new ForensicLog(forensicLogPath)
    setForensicLog(forensicLog)

    this._resources.config = config
    this._resources.target = target
    this._resources.workspace = workspace
    this._resources.memoryStore = memoryStore
    this._resources.memory = memory
    this._resources.threadId = threadId
    this._resources.resourceId = resourceId
    this._resources.forensicLog = forensicLog

    // Activate scope guard from config
    setScopeConfig(config.scope ?? null)

    this.registerCleanup(async () => {
      log.dim('Saving graph and OAST state...')
      await Promise.all([
        workspace.getGraphStore()?.save(),
        workspace.getOastStore()?.save(),
      ])
    })

    this.phase = 'config'
    log.info(`Target: ${target || '(none)'}`)

    // Phase 1: Browser
    await this.launchBrowser()

    // Phase 2: Infrastructure
    await this.startInfrastructure()

    return this._resources as SessionResources
  }

  // ── Phase 1: Browser (with validation) ───────────────────────────

  private async launchBrowser(): Promise<void> {
    this.assertPhase('config')
    const { config, target } = this._resources as { config: UltimatrixConfig; target: string }

    const [browser, oastPort] = await Promise.all([
      (async () => {
        const b = getOrCreateBrowser(config)
        await b.ensureReady()
        return b
      })(),
      startOastServer(),
    ])

    // Validate CDP connection works
    await this.validateBrowser(browser)

    // NOW start dialog watcher — browser is fully ready
    startDialogWatcher(browser)

    // Programmatic navigation — establish initial state before spider LLM runs
    // The entire downstream system (human observer, spider, dialog watcher) assumes
    // the browser is at the target URL. This ensures that precondition is always true.
    if (target) {
      const page = getActivePage()
      if (page) {
        try {
          log.info(`Navigating to ${target}...`)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const status = response?.status() || 'unknown'
          const title = await page.title().catch(() => '')
          log.info(`Loaded ${target} — status: ${status}, title: "${title}"`)
        } catch (err) {
          log.warn(`Initial navigation failed: ${err instanceof Error ? err.message : String(err)}`)
          log.info('Spider will attempt navigation via browser tools.')
        }
      }
    }

    this._resources.browser = browser
    this._resources.oastPort = oastPort

    this.registerCleanup(async () => {
      log.dim('Stopping OAST server...')
      await stopOastServer()
    })

    this.registerCleanup(async () => {
      log.dim('Closing browser...')
      stopDialogWatcher()
      try { getGlobalReactionObserver().detach() } catch {}
      await closeBrowser()
    })

    this.phase = 'browser'
    log.info(`OAST server started on port ${oastPort}`)
  }

  private async validateBrowser(browser: any): Promise<void> {
    const page = getActivePage()
    if (!page) {
      throw new Error('Browser validation failed: no active page after ensureReady()')
    }
    try {
      await page.evaluate(() => document.readyState)
    } catch (err) {
      throw new Error(`Browser validation failed: page not responsive — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Phase 2: Infrastructure ──────────────────────────────────────

  private async startInfrastructure(): Promise<void> {
    this.assertPhase('browser')
    const { config, target, forensicLog } = this._resources as SessionResources

    // Human observer — deferred 3s for browser to settle
    const observer = getGlobalObserver()
    const attachObserver = () => {
      const page = getActivePage()
      if (page && !observer.isCapturing()) {
        observer.attach(page)
        observer.onAction((action) => {
          forensicLog.log({
            type: 'human-action',
            agent: 'human',
            args: { type: action.type, selector: action.selector, url: action.url, value: action.value },
          })
        })
        log.dim('Human action capture active')
      }
    }
    setTimeout(attachObserver, 3000)

    if (!config.browser.headless) {
      log.info('Browser is visible — interact with it directly')
      log.info('   The agent captures your actions automatically')
    } else {
      log.dim('Browser is headless (set HEADLESS=false to see it)')
    }

    // HAR capture
    let harCapture: HarCapture | null = null
    if (target) {
      try {
        harCapture = await startHarCapture(target, ['localhost', '127.0.0.1'])
        log.info('HAR capture started')
      } catch (err) {
        log.dim('HAR capture unavailable: ' + (err instanceof Error ? err.message : String(err)))
      }
    }
    this._resources.harCapture = harCapture

    if (harCapture) {
      this.registerCleanup(async () => {
        log.dim('Stopping HAR capture...')
        try { await harCapture!.stop() } catch {}
      })
    }

    // Readline
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    setReadlineInterface(rl)
    this._resources.readline = rl

    this.registerCleanup(async () => {
      rl.close()
    })

    // userInputEmitter for askUser tool
    const onAskUser = (question: string) => {
      process.stdout.write('\n' + question + ' ')
      rl.once('line', (answer: string) => {
        userInputEmitter.emit('askUser-response', answer)
      })
    }
    userInputEmitter.on('askUser-question', onAskUser)

    this.registerCleanup(async () => {
      userInputEmitter.removeListener('askUser-question', onAskUser)
    })

    // SIGINT handler (registered once)
    this.setupSIGINT()

    this.phase = 'infrastructure'
  }

  // ── Phase 3: Spider ──────────────────────────────────────────────

  async runSpider(): Promise<void> {
    this.assertPhase('infrastructure')
    const { config, target, browser, memory, threadId, resourceId } = this._resources as SessionResources

    if (!target) {
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

    try {
      const spiderAgent = createSpiderAgent(config, memory, browser)
      const spiderLoopDetector = new LoopDetector(config.antiLoop?.maxFailedTarget ?? DEFAULTS.antiLoop.maxFailedTarget)
      const staleThreshold = config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold

      const result = await spiderAgent.stream(
        `Navigate to ${target} using stagehand_navigate. Use stagehand tools to dismiss overlays, discover forms and record them, detect auth flows and record their structure (do NOT submit login forms without credentials). Record everything with the graph tools. Report all findings.`,
        { memory: { thread: threadId + '-spider', resource: resourceId + '-spider' }, maxSteps: config.spider?.maxSteps ?? config.agent.maxSteps },
      )

      let endpointsBefore = workspace.getGraphStore()?.queryNodes?.(NodeType.ENDPOINT)?.length || 0
      let pagesBefore = workspace.getGraphStore()?.queryNodes?.(NodeType.PAGE)?.length || 0
      let findingsBefore = workspace.getGraphStore()?.queryNodes?.(NodeType.FINDING)?.length || 0
      
      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
          case 'reasoning-delta':
            process.stdout.write(chunk.payload.text)
            break
          case 'tool-call':
            if (chunk.payload.toolName !== 'askUser') {
              log.dim(`  \u2192 ${chunk.payload.toolName}`)
            }
            break
          case 'tool-result': {
            const endpointsNow = workspace.getGraphStore()?.queryNodes?.(NodeType.ENDPOINT)?.length || 0
            const pagesNow = workspace.getGraphStore()?.queryNodes?.(NodeType.PAGE)?.length || 0
            const findingsNow = workspace.getGraphStore()?.queryNodes?.(NodeType.FINDING)?.length || 0
            
            const newEndpoints = endpointsNow - endpointsBefore
            const newPages = pagesNow - pagesBefore
            const newFindings = findingsNow - findingsBefore
            
            if (newEndpoints > 0 || newPages > 0 || newFindings > 0) {
              process.stdout.write(`\n[Spider] Progress: +${newEndpoints} endpoints, +${newPages} pages, +${newFindings} findings\n`)
            }
            
            spiderLoopDetector.recordRound(newEndpoints > 0)
            endpointsBefore = endpointsNow
            pagesBefore = pagesNow
            findingsBefore = findingsNow

            if (spiderLoopDetector.isStale(staleThreshold)) {
              log.warn('Spider stale — no new endpoints for several rounds, stopping crawl')
              break
            }
            break
          }
          case 'tool-error':
            log.error(`  Spider: ${chunk.payload.toolName}: ${chunk.payload.error}`)
            break
        }
      }
      
      // Post-crawl verification
      const finalSummary = workspace.getGraphStore()?.getTargetSummary()
      if (finalSummary) {
        log.dim(`[Spider] Crawl complete - Final summary: ${finalSummary.totalEndpoints} endpoints, ${finalSummary.totalPages} pages, ${finalSummary.totalFindings} findings`)
        
        // Verify minimum thresholds
        if (finalSummary.totalEndpoints === 0) {
          log.warn('[Spider] Warning: No endpoints discovered - navigation may have failed')
        }
        if (finalSummary.totalPages === 0) {
          log.warn('[Spider] Warning: No pages recorded - page recording may be failing')
        }
      }
      
      await workspace.getGraphStore()?.save()
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
      workspace.getGraphStore()?.save().catch(() => {})
    }

    // HAR bridge
    const harCapture = this._resources.harCapture
    if (harCapture) {
      try {
        const harJson = await harCapture.stop()
        if (harJson) {
          const capturesDir = resolve(workspace.getTargetDir(target), 'captures')
          await mkdir(capturesDir, { recursive: true })
          const harPath = resolve(capturesDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.har`)
          await writeFile(harPath, harJson, 'utf-8')
          log.success('HAR saved: ' + harPath)

          try {
            const bridgeResult = await bridgeHARToGraph(harJson, target)
            if (bridgeResult.contextForLLM) {
              this._resources.harContextForLLM = bridgeResult.contextForLLM
              log.success(`HAR bridge: ${bridgeResult.endpointsWritten} endpoints, ${bridgeResult.secretsWritten} secrets, ${bridgeResult.factsWritten} facts, ${bridgeResult.hypothesesGenerated} hypotheses → graph`)
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

    this.phase = 'spider'
  }

  // ── Phase 4: Engine setup ────────────────────────────────────────

  async setupEngine(): Promise<void> {
    this.assertPhase('spider')
    const { config, browser, memory, target, harContextForLLM } = this._resources as SessionResources

    const useSolver = config.engine === 'solver' || config.engine === 'multi-model'

    if (!useSolver) {
      const workers = await createAllWorkers(config, browser, memory)
      const supervisor = createSupervisor(config, { workers, browser, memory })
      this._resources.workers = workers
      this._resources.supervisor = supervisor
    } else {
      const skillRegistry = new SkillRegistry()
      skillRegistry.loadFromDirectory('skills')
      const workerPool = new WorkerPool(config, skillRegistry, browser)

      const solverBrain = createSolverBrain(config, {
        skillRegistry,
        workerPool,
        browser,
        memory,
        extraContext: harContextForLLM,
      })

      this._resources.solverBrain = solverBrain
      this._resources.skillRegistry = skillRegistry
      this._resources.workerPool = workerPool
      this._resources.sessionBlackboard = new Blackboard({ origin: target || 'unknown', goal: 'Session started' })
      this._resources.sessionEvidence = new EvidenceGate()
      this._resources.sessionLoopDetector = new LoopDetector(config.antiLoop?.maxFailedTarget ?? DEFAULTS.antiLoop.maxFailedTarget)
      this._resources.sessionReflexion = config.reflexion?.enabled === false
        ? undefined
        : new ReflexionEngine({
            maxSameVulnFails: config.reflexion?.maxSameVulnFails,
            maxTotalNoProgress: config.reflexion?.maxTotalNoProgress,
            escalationMaxLevel: config.reflexion?.escalationMaxLevel,
          })
    }

    log.info(useSolver ? 'Solver engine ready with orchestration tools' : 'Legacy engine ready')

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

  // ── Phase 5: REPL loop ───────────────────────────────────────────

  async runREPL(onInput: (line: string) => Promise<void>): Promise<void> {
    this.assertPhase('engine')
    this.phase = 'running'

    const { config, target, oastPort, readline: rl } = this._resources as SessionResources
    const useSolver = config.engine === 'solver' || config.engine === 'multi-model'

    log.banner(
      'Ultimatrix v8',
      'Model: ' + config.provider + '/' + config.model + (target ? '  |  Target: ' + target : '') + `  |  OAST: :${oastPort}` + (useSolver ? '  |  Engine: solver' : '  |  Engine: legacy'),
    )

    if (!target) {
      log.info('No target set. Tell me a URL to investigate.')
    }

    log.nl()
    log.dim(useSolver
      ? 'Entering interactive mode (solver engine). Type your goal or Ctrl+C to exit.'
      : 'Entering interactive mode. Type your message or Ctrl+C to exit.')
    log.nl()

    try {
      for (;;) {
        process.stdout.write('> ')
        const line = await getLine(rl)
        if (line === null) break
        if (!line.trim()) continue

        try {
          process.stdout.write('\n')
          await onInput(line)
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

  // ── Chain detection (called after each REPL turn) ────────────────

  detectAndReportChains(): void {
    const graph = this._resources.workspace?.getGraphStore()
    if (!graph) return

    const allNodes = graph.queryNodes()
    const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]
    if (findings.length > 0) {
      const chains = detectChains(findings)
      for (const chain of chains) {
        log.info('Chain detected: ' + chain.rule.name + ' — ' + chain.source.properties.technique + ' → ' + chain.target.properties.technique + ' (' + chain.rule.severity + ')')
        this._resources.sessionBlackboard?.addFact(
          `Chain detected: ${chain.source.properties.technique} → ${chain.target.properties.technique} (${chain.rule.description}) [severity=${chain.rule.severity}]`,
          'chain',
        )
      }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  async cleanup(): Promise<void> {
    if (this.phase === 'done') return
    this.phase = 'done'

    log.info('Shutting down gracefully...')

    // Run cleanups in reverse order (LIFO)
    for (const fn of this.cleanupFns.reverse()) {
      try {
        await fn()
      } catch (err) {
        log.dim(`Cleanup error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    this.printSummary()
  }

  private registerCleanup(fn: () => Promise<void>): void {
    this.cleanupFns.push(fn)
  }

  // ── SIGINT handler ───────────────────────────────────────────────

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

  // ── Summary ──────────────────────────────────────────────────────

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

  // ── Validation ───────────────────────────────────────────────────

  private assertPhase(expected: SessionPhase): void {
    if (this.phase !== expected) {
      throw new Error(`Lifecycle: expected phase '${expected}', got '${this.phase}'`)
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function getLine(rl: ReadlineInterface): Promise<string | null> {
  return new Promise(resolve => {
    const onLine = (line: string) => {
      rl.removeListener('close', onClose)
      resolve(line)
    }
    const onClose = () => {
      rl.removeListener('line', onLine)
      resolve(null)
    }
    rl.once('line', onLine)
    rl.once('close', onClose)
  })
}
