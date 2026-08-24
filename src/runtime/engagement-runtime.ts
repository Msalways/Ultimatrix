import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { UltimatrixConfig } from '../config'
import { WorkspaceManager } from '../workspace'
import { GraphStore } from '../graph/store'
import { OastStore } from '../oast/store'
import { WorkflowStore } from '../workflow/store'
import { DecisionLedger, type DecisionLedgerSnapshot } from '../security/decision-ledger'
import { ArtifactRegistry } from '../security/artifacts'
import { EvidenceLedger } from '../intelligence/evidence-ledger'
import { UsageTracker } from '../usage/tracker'
import { ForensicLog } from '../logging/forensic-log'
import { EngagementBoundary } from '../spider/runtime'
import { resolveBrowserProvider, type BrowserProvider, type BrowserSession } from '../browser/provider'
import { deriveScopeFromTarget } from '../safety/scope-guard'
import { runWithEngagementServices, type EngagementServices } from './engagement-context'
import { HumanObserver } from '../capture/human-observer'
import { ReactionObserver } from '../browser/reaction-observer'
import { DialogWatcher } from '../browser/dialog-watcher'
import { ActionRecorder } from '../recorder'
import { createBrowserManagerState } from '../browser/manager'
import { PassiveObserver } from '../capture/passive-observer'
import { BotDetectionHandler } from '../browser/anti-bot'
import { TypedEventEmitter } from '../events/emitter'
import { SessionManager } from '../http/session-manager'
import { QuotaTracker } from '../models/quota-tracker'
import { ToolEventEmitter } from '../lib/tool-events'

export type WorkflowOutcome =
  | { status: 'completed' }
  | { status: 'failed'; error: string }
  | { status: 'aborted'; reason: string }

export interface EngagementRuntimeOptions {
  outputDir?: string
  workflowId?: string
  allowAny?: boolean
  browserProvider?: BrowserProvider
}

export class EngagementRuntime {
  readonly services: EngagementServices
  readonly boundary: EngagementBoundary
  readonly browser: BrowserProvider
  browserSession?: BrowserSession
  private browserStart?: Promise<BrowserSession>
  private closed = false

  constructor(
    readonly config: UltimatrixConfig,
    readonly target: string,
    readonly workflow: WorkflowStore,
    services: EngagementServices,
    browser: BrowserProvider,
    allowAny: boolean,
  ) {
    this.services = services
    this.browser = browser
    this.boundary = new EngagementBoundary(target, config, allowAny, workflow.state.workflowId)
  }

  get workspace(): WorkspaceManager { return this.services.workspace }
  get graph(): GraphStore { return this.services.graph }
  get oast(): OastStore { return this.services.oast }
  get decisions(): DecisionLedger { return this.services.decisions }
  get artifacts(): ArtifactRegistry { return this.services.artifacts }
  get evidence(): EvidenceLedger { return this.services.evidence }
  get usage(): UsageTracker { return this.services.usage }
  get forensicLog(): ForensicLog { return this.services.forensicLog }

  run<T>(operation: () => T): T {
    if (this.closed) throw new Error(`Engagement runtime ${this.workflow.state.workflowId} is closed`)
    return runWithEngagementServices(this.services, operation)
  }

  async startBrowser(): Promise<BrowserSession> {
    if (this.browserSession) return this.browserSession
    if (this.browserStart) return this.browserStart
    this.browserStart = (async () => {
      const sessionId = this.workflow.state.browserSessionId ?? `browser-${randomUUID()}`
      this.services.events.emit('browser:starting' as any, {
        provider: this.browser.name,
        headless: this.config.browser.headless,
        env: this.config.browser.env,
        timestamp: Date.now(),
      })
      let session: BrowserSession
      try {
        session = await this.run(() => this.browser.start({
          config: this.config,
          workflowId: this.workflow.state.workflowId,
          sessionId,
        }))
      } catch (error) {
        this.services.events.emit('browser:failed' as any, {
          provider: this.browser.name,
          headless: this.config.browser.headless,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        })
        throw error
      }
      this.browserSession = session
      this.workflow.setBrowserProvider(session.provider)
      this.workflow.setBrowserSessionId(session.sessionId)
      await this.saveCheckpoint('browser-started')
      this.services.events.emit('browser:ready' as any, {
        provider: session.provider,
        headless: this.config.browser.headless,
        env: this.config.browser.env,
        sessionId: session.sessionId,
        timestamp: Date.now(),
      })
      return session
    })().finally(() => {
      this.browserStart = undefined
    })
    return this.browserStart
  }

  async saveCheckpoint(_reason: string): Promise<void> {
    await this.run(async () => {
      this.workflow.syncEvidence(this.evidence.all())
      this.workflow.syncModelUsage(this.usage.getEntries())
      await this.graph.save()
      await this.oast.save()
      if (this.services.recorder?.getInteractions().length) await this.services.recorder.save()
      const ledgerPath = resolve(this.workspace.getTargetDir(this.target), 'decisions.json')
      const temporaryLedgerPath = `${ledgerPath}.tmp`
      await writeFile(temporaryLedgerPath, JSON.stringify(this.decisions.snapshot(), null, 2), 'utf8')
      await rename(temporaryLedgerPath, ledgerPath)
      this.workflow.setDecisionLedgerId('decisions.json')
      await this.workflow.save()
    })
  }

  async close(outcome: WorkflowOutcome): Promise<void> {
    if (this.closed) return
    await this.run(async () => {
      this.workflow.setStatus(outcome.status === 'completed' ? 'completed' : outcome.status === 'aborted' ? 'aborted' : 'failed')
      await this.saveCheckpoint(`close:${outcome.status}`)
    })
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    try {
      await this.run(async () => {
        if (this.browserSession) await this.browser.close(this.browserSession.sessionId)
        this.services.events.removeAllListeners()
        this.services.toolEvents.removeAllListeners()
      })
    } finally {
      this.closed = true
    }
  }
}

export async function createEngagementRuntime(
  config: UltimatrixConfig,
  target: string,
  options: EngagementRuntimeOptions = {},
): Promise<EngagementRuntime> {
  const browser = options.browserProvider ?? resolveBrowserProvider(config)
  const workspace = new WorkspaceManager(options.outputDir)
  await workspace.ensureTarget(target)
  const targetDir = workspace.getTargetDir(target)
  const graph = new GraphStore(resolve(targetDir, 'graph.json'))
  const oast = new OastStore(1000, resolve(targetDir, 'oast-callbacks.json'))
  await Promise.all([graph.load(), oast.load()])
  workspace.useTargetStores(target, graph, oast)

  const workflow = await WorkflowStore.loadOrCreate(resolve(targetDir, 'workflow.json'), {
    target,
    workflowId: options.workflowId,
    browserProvider: browser.name,
  })
  const decisions = new DecisionLedger()
  decisions.setWorkflowId(workflow.state.workflowId)
  try {
    const snapshot = JSON.parse(await readFile(resolve(targetDir, 'decisions.json'), 'utf8')) as DecisionLedgerSnapshot
    if (Array.isArray(snapshot.decisions) && Array.isArray(snapshot.provenance)) decisions.restore(snapshot)
  } catch {
    // A new engagement has no ledger snapshot yet.
  }
  const artifacts = new ArtifactRegistry(workflow.state.workflowId, record => workflow.recordArtifact(record))
  const evidence = new EvidenceLedger()
  const usage = new UsageTracker()
  const forensicLog = new ForensicLog(resolve(targetDir, 'logs', 'forensic.ndjson'))
  const allowAny = options.allowAny ?? false
  const services: EngagementServices = {
    workspace,
    graph,
    oast,
    decisions,
    artifacts,
    evidence,
    usage,
    forensicLog,
    humanObserver: new HumanObserver(),
    reactionObserver: new ReactionObserver(),
    dialogWatcher: new DialogWatcher(),
    recorder: new ActionRecorder(target, workflow.state.workflowId, resolve(targetDir, 'recordings')),
    browserManager: createBrowserManagerState(),
    passiveObserver: new PassiveObserver(),
    botHandler: new BotDetectionHandler(),
    oastConfig: config.oast ?? null,
    events: new TypedEventEmitter(),
    httpSessions: new SessionManager(),
    quota: new QuotaTracker(),
    toolEvents: new ToolEventEmitter(),
    providerLimiters: new Map(),
    findingState: { evidenceBuffer: new Map(), evidenceGate: null },
    scopeConfig: config.scope ?? deriveScopeFromTarget(target),
    externalTools: config.externalTools ?? null,
    allowAny,
  }
  return new EngagementRuntime(config, target, workflow, services, browser, allowAny)
}
