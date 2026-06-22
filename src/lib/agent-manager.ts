import type { StagehandBrowser } from '@mastra/stagehand'
import { Agent } from '@mastra/core/agent'
import { getOrCreateBrowser, closeBrowser } from '../browser/manager'
import { createSupervisor } from '../manager/agent'
import { loadConfig } from '../config'
import type { UltimatrixConfig } from '../config'
import { startOastServer, stopOastServer } from '../oast/server'
import { getGlobalGraphStore } from '../graph/store'
import { getGlobalOastStore } from '../oast/store'
import { createAllWorkers, createMemoryStore, createMemory } from '../workers/registry'
import { FindingNode } from '../graph/schema'
import { log } from '../utils/logger'
import { generateSpecCode } from '../recorder/codegen'
import { getToolEventEmitter } from './tool-events'
import { SkillRegistry } from '../skills/registry'
import { WorkerPool } from '../workers/pool'
import { ScanManager } from '../scan-manager'
import { ContextWriter } from '../context/writer'
import { ContextReader } from '../context/reader'
import { AppModel, Finding, Trace } from '../context/schemas'

export class AgentManager {
  private static instance: AgentManager

  private skillRegistry: SkillRegistry | null = null
  private workerPool: WorkerPool | null = null

  private scanManager: ScanManager | null = null
  private contextWriter: ContextWriter | null = null
  private contextReader: ContextReader | null = null
  private currentScanId: string | null = null

  private browser: StagehandBrowser | null = null
  private supervisor: Agent | null = null
  private workers: Record<string, Agent> | null = null
  private config: UltimatrixConfig | null = null
  private oastPort: number | null = null
  private initialized = false
  private initErrors: string[] = []

  static getInstance(): AgentManager {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager()
    }
    return AgentManager.instance
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getConfig(): UltimatrixConfig {
    if (!this.config) throw new Error('AgentManager not initialized')
    return this.config
  }

  getSupervisor(): Agent {
    if (!this.supervisor) throw new Error('AgentManager not initialized')
    return this.supervisor
  }

  getBrowser(): StagehandBrowser | null {
    return this.browser
  }

  getOastPort(): number | null {
    return this.oastPort
  }

  getInitErrors(): string[] {
    return this.initErrors
  }

  getScanManager(): ScanManager {
    if (!this.scanManager) throw new Error('AgentManager not initialized')
    return this.scanManager
  }

  getContextWriter(): ContextWriter {
    if (!this.contextWriter) throw new Error('AgentManager not initialized')
    return this.contextWriter
  }

  getContextReader(): ContextReader {
    if (!this.contextReader) throw new Error('AgentManager not initialized')
    return this.contextReader
  }

  getCurrentScanId(): string | null {
    return this.currentScanId
  }

  getSkillRegistry(): SkillRegistry {
    if (!this.skillRegistry) throw new Error('AgentManager not initialized')
    return this.skillRegistry
  }

  getWorkerPool(): WorkerPool {
    if (!this.workerPool) throw new Error('AgentManager not initialized')
    return this.workerPool
  }

  getSkills() {
    if (!this.skillRegistry) return []
    return this.skillRegistry.list()
  }

  getWorkers(): Agent[] {
    if (!this.workerPool) return []
    return this.workerPool.list()
  }

  async createScan(scanId: string, target?: string): Promise<void> {
    if (!this.scanManager) {
      this.scanManager = new ScanManager({ scansDir: this.config?.agent.scansDir ?? './scans' })
      await this.scanManager.initialize()
    }

    await this.scanManager.createScan(scanId, target)
    this.currentScanId = scanId

    this.contextWriter = new ContextWriter({ scanId })
    this.contextReader = new ContextReader({ scanId })
    await this.contextWriter.initialize()
    await this.contextReader.initialize()

    log.info(`Created scan context for ${scanId}`)
  }

  async loadScan(scanId: string): Promise<void> {
    if (!this.scanManager) {
      this.scanManager = new ScanManager({ scansDir: this.config?.agent.scansDir ?? './scans' })
      await this.scanManager.initialize()
    }

    const scanInfo = await this.scanManager.getScan(scanId)
    if (!scanInfo) {
      throw new Error(`Scan ${scanId} not found`)
    }

    this.currentScanId = scanId
    this.contextWriter = new ContextWriter({ scanId })
    this.contextReader = new ContextReader({ scanId })
    await this.contextWriter.initialize()
    await this.contextReader.initialize()

    log.info(`Loaded scan context for ${scanId}`)
  }

  async getAppModel(): Promise<AppModel | null> {
    if (!this.contextReader) throw new Error('ContextReader not initialized')
    return await this.contextReader.readAppModel()
  }

  async getFindings(): Promise<Finding[]> {
    if (!this.contextReader) throw new Error('ContextReader not initialized')
    const findings = await this.contextReader.readFindings()
    return findings.map((f: any) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      properties: f.properties,
      createdAt: new Date(f.createdAt),
      updatedAt: new Date(f.updatedAt),
    }))
  }

  async getTraces(): Promise<Trace[]> {
    if (!this.contextReader) throw new Error('ContextReader not initialized')
    return await this.contextReader.readTraces()
  }

  async writeAppModel(appModel: AppModel): Promise<void> {
    if (!this.contextWriter) throw new Error('ContextWriter not initialized')
    await this.contextWriter.writeAppModel(appModel)
  }

  async writeFindings(findings: Finding[]): Promise<void> {
    if (!this.contextWriter) throw new Error('ContextWriter not initialized')
    await this.contextWriter.writeFindings(findings)
  }

  async writeTraces(traces: Trace[]): Promise<void> {
    if (!this.contextWriter) throw new Error('ContextWriter not initialized')
    await this.contextWriter.writeTraces(traces)
  }

  async chat(messages: any[], threadId?: string): Promise<any> {
    if (!this.supervisor) throw new Error('AgentManager not initialized')
    const events = getToolEventEmitter()
    events.push({ type: 'agent-start', message: 'Agent processing...', timestamp: Date.now(), details: { messageCount: messages.length } })

    const memory = this.currentScanId
      ? { thread: threadId ?? 'ultimatrix-web-' + Date.now(), resource: 'ultimatrix' }
      : { thread: threadId ?? 'ultimatrix-web-' + Date.now(), resource: 'ultimatrix' }

    const result = await this.supervisor.stream(messages, {
      memory,
      maxSteps: this.config?.agent.maxSteps ?? 50,
      onChunk: (chunk: any) => {
        if (chunk.type === 'tool-call') {
          events.push({
            type: 'tool-call',
            message: `Calling ${chunk.payload?.toolName || 'unknown'}...`,
            timestamp: Date.now(),
            toolName: chunk.payload?.toolName,
            details: { args: chunk.payload?.args },
          })
        } else if (chunk.type === 'tool-result') {
          events.push({
            type: 'tool-result',
            message: `${chunk.payload?.toolName || 'Tool'} completed`,
            timestamp: Date.now(),
            toolName: chunk.payload?.toolName,
          })
        } else if (chunk.type === 'error') {
          events.push({
            type: 'error',
            message: chunk.payload?.error || 'Unknown error',
            timestamp: Date.now(),
          })
        } else if (chunk.type === 'reasoning') {
          events.push({
            type: 'reasoning',
            message: chunk.payload?.text || '',
            timestamp: Date.now(),
          })
        }
      },
    })

    events.push({ type: 'agent-end', message: 'Agent response complete', timestamp: Date.now() })
    return result
  }

  async init(config?: UltimatrixConfig): Promise<void> {
    if (this.initialized && !config) return
    this.initErrors = []

    const cfg = config ?? loadConfig()
    this.config = cfg

    // Initialize scan manager
    this.scanManager = new ScanManager({ scansDir: cfg.agent.scansDir })
    await this.scanManager.initialize()

    // Initialize skill registry
    try {
      this.skillRegistry = new SkillRegistry()
      this.skillRegistry.loadFromDirectory('./skills')
      log.info(`Loaded ${this.skillRegistry.count()} skills from ./skills`)
    } catch (e) {
      const msg = `Skill registry failed: ${e instanceof Error ? e.message : String(e)}`
      this.initErrors.push(msg)
      log.warn(msg)
      this.skillRegistry = null
    }

    if (this.skillRegistry) {
      this.workerPool = new WorkerPool(cfg, this.skillRegistry)
    }

    await createMemoryStore()
    const memory = await createMemory(cfg)
    await getGlobalGraphStore().load()
    await getGlobalOastStore().load()

    const deployed = process.env.DEPLOYED === 'true'
    const events = getToolEventEmitter()

    if (!deployed) {
      events.push({ type: 'info', message: 'Starting browser...', timestamp: Date.now() })
      try {
        const browser = getOrCreateBrowser(cfg)
        await browser.ensureReady()
        if (!browser.isBrowserRunning()) {
          await browser.launch()
        }
        this.browser = browser
        events.push({ type: 'info', message: 'Browser ready', timestamp: Date.now() })
      } catch (e) {
        const msg = `Browser failed: ${e instanceof Error ? e.message : String(e)}`
        this.initErrors.push(msg)
        events.push({ type: 'error', message: msg, timestamp: Date.now() })
        log.error(msg)
      }

      events.push({ type: 'info', message: 'Starting OAST server...', timestamp: Date.now() })
      try {
        const oastPort = await startOastServer()
        this.oastPort = oastPort
        events.push({ type: 'info', message: `OAST server ready on port ${oastPort}`, timestamp: Date.now() })
        log.info(`OAST server started on port ${oastPort}`)
      } catch (e) {
        const msg = `OAST failed: ${e instanceof Error ? e.message : String(e)}`
        this.initErrors.push(msg)
        events.push({ type: 'error', message: msg, timestamp: Date.now() })
        log.error(msg)
      }
    } else {
      this.browser = null
      this.oastPort = null
      events.push({ type: 'info', message: 'Running in DEPLOYED mode — HTTP-only', timestamp: Date.now() })
      log.info('Running in DEPLOYED mode — no browser, HTTP-only')
    }

    events.push({ type: 'info', message: 'Initializing agents...', timestamp: Date.now() })
    try {
      if (this.skillRegistry && this.workerPool) {
        // Dynamic mode: use skill-driven supervisor
        this.supervisor = createSupervisor(cfg, {
          skillRegistry: this.skillRegistry,
          workerPool: this.workerPool,
          browser: this.browser ?? undefined,
          memory,
        })
        // Keep legacy workers for backward compatibility
        this.workers = await createAllWorkers(cfg, this.browser ?? undefined, memory)
      } else {
        // Legacy mode: use hardcoded workers
        this.workers = await createAllWorkers(cfg, this.browser ?? undefined, memory)
        this.supervisor = createSupervisor(cfg, { workers: this.workers, browser: this.browser ?? undefined, memory })
      }
    } catch (e) {
      const msg = `Agent creation failed: ${e instanceof Error ? e.message : String(e)}`
      this.initErrors.push(msg)
      events.push({ type: 'error', message: msg, timestamp: Date.now() })
      log.error(msg)
      throw e
    }

    this.initialized = true
    events.push({ type: 'info', message: `Agent ready — ${cfg.model}${cfg.target ? ' targeting ' + cfg.target : ''}`, timestamp: Date.now() })
    log.banner('Ultimatrix Security Assistant v6',
      'Model: ' + cfg.model + (cfg.target ? '  |  Target: ' + cfg.target : '') + (this.oastPort ? `  |  OAST: :${this.oastPort}` : ''))
  }

  async updateConfig(partial: Partial<UltimatrixConfig>): Promise<void> {
    if (!this.config) {
      await this.init(loadConfig())
      return
    }

    const keys = Object.keys(partial) as (keyof UltimatrixConfig)[]
    const onlyTarget = keys.length === 1 && keys[0] === 'target'
    const cfgKeys = ['provider', 'model', 'creds', 'modelTiers', 'browser', 'memory', 'agent'] as (keyof UltimatrixConfig)[]
    const needsReinit = cfgKeys.some(k => k in partial)

    if (onlyTarget || !needsReinit) {
      this.config = { ...this.config, ...partial }
      log.info(`Config updated (${onlyTarget ? 'target only' : 'non-critical fields'}) — no reinit needed`)
      return
    }

    const merged = { ...this.config, ...partial } as UltimatrixConfig
    await this.stop()
    await this.init(merged)
  }

  async getFindingsFromGraph(): Promise<FindingNode[]> {
    const graph = getGlobalGraphStore()
    const nodes = graph.queryNodes()
    return nodes.filter(n => n.type === 'Finding') as FindingNode[]
  }

  async getCode(): Promise<string[]> {
    try {
      const { getGlobalRecorder } = await import('../recorder/index')
      const recorder = getGlobalRecorder()
      if (!recorder) return []
      const testCases = recorder.getTestCases()
      if (testCases.length === 0) return []
      const code = generateSpecCode(testCases, 'web-viewer')
      const lines = code.split('\n')
      const chunks: string[] = []
      for (let i = 0; i < lines.length; i += 50) {
        chunks.push(lines.slice(i, i + 50).join('\n'))
      }
      return chunks.length > 0 ? chunks : [code]
    } catch {
      return []
    }
  }

  async runSpiderCrawl(targetUrl?: string): Promise<void> {
    if (!this.browser) throw new Error('Browser not initialized')
    if (!this.config) throw new Error('AgentManager not initialized')

    const target = targetUrl ?? this.config.target
    if (!target) throw new Error('No target URL specified')

    const { createSpiderAgent } = await import('../spider/agent')
    const { createMemory, createMemoryStore } = await import('../workers/registry')
    const { getGlobalGraphStore } = await import('../graph/store')
    const { getToolEventEmitter } = await import('./tool-events')

    const events = getToolEventEmitter()
    events.push({ type: 'info', message: `Starting spider crawl for ${target}...`, timestamp: Date.now() })

    const store = await createMemoryStore()
    const memory = await createMemory(this.config, store)
    const spiderAgent = createSpiderAgent(this.config, memory, this.browser)

    const threadId = `spider-${Date.now()}`
    const result = await spiderAgent.stream(
      `Navigate to ${target} using stagehand_navigate. Use stagehand tools to dismiss overlays, discover forms/fill them, detect auth flows (login/logout/refresh), and record everything with updateGraph. Report all findings.`,
      { memory: { thread: threadId, resource: 'ultimatrix-spider' }, toolChoice: 'required' },
    )

    for await (const chunk of result.fullStream) {
      if (chunk.type === 'tool-call') {
        events.push({
          type: 'tool-call',
          message: `Spider: Calling ${chunk.payload?.toolName || 'unknown'}...`,
          timestamp: Date.now(),
          toolName: chunk.payload?.toolName,
          details: { args: chunk.payload?.args },
        })
      } else if (chunk.type === 'tool-result') {
        events.push({
          type: 'tool-result',
          message: `Spider: ${chunk.payload?.toolName || 'Tool'} completed`,
          timestamp: Date.now(),
          toolName: chunk.payload?.toolName,
        })
      } else if (chunk.type === 'error') {
        events.push({
          type: 'error',
          message: `Spider error: ${chunk.payload?.error || 'Unknown error'}`,
          timestamp: Date.now(),
        })
      } else if ((chunk as any).type === 'reasoning') {
        events.push({
          type: 'reasoning',
          message: (chunk as any).payload?.text || '',
          timestamp: Date.now(),
        })
      }
    }

    await getGlobalGraphStore().save()
    events.push({ type: 'info', message: 'Spider crawl completed', timestamp: Date.now() })
  }

  async saveContext(): Promise<void> {
    if (!this.contextWriter || !this.currentScanId) {
      log.warn('No context writer or scan ID available for saving')
      return
    }

    try {
      const appModel = await this.getAppModel()
      const findings = await this.getFindings()
      const traces = await this.getTraces()

      if (appModel) await this.contextWriter.writeAppModel(appModel)
      if (findings.length > 0) await this.contextWriter.writeFindings(findings)
      if (traces.length > 0) await this.contextWriter.writeTraces(traces)

      await getGlobalGraphStore().save()
      log.info(`Saved context for scan ${this.currentScanId}`)
    } catch (error) {
      log.error(`Failed to save context:`, error)
      throw error
    }
  }

  async stop(): Promise<void> {
    getToolEventEmitter().push({ type: 'info', message: 'Shutting down agent...', timestamp: Date.now() })

    if (this.currentScanId) {
      await this.saveContext()
    }

    await getGlobalGraphStore().save()
    await getGlobalOastStore().save()
    await stopOastServer()
    await closeBrowser()
    this.browser = null
    this.supervisor = null
    this.workers = null
    this.skillRegistry = null
    this.workerPool = null
    this.scanManager = null
    this.contextWriter = null
    this.contextReader = null
    this.currentScanId = null
    this.initialized = false
    this.oastPort = null
    this.config = null
  }
}
