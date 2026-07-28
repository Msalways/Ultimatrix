import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { loadConfig, type UltimatrixConfig } from '../config'
import { getGlobalWorkspace } from '../workspace'
import { GraphStore } from '../graph/store'
import { OastStore } from '../oast/store'
import { SkillRegistry } from '../solver/skills/registry'
import { WorkerPool } from '../workers/pool'
import { createSolverBrain } from '../solver/brain-tools'
import { solve, type SolverStreamMessage, type SolveParams, type SolveResult, type PhaseEvent, type SolverConfig } from '../solver/solver'
import { Blackboard } from '../core/blackboard'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { LoopDetector } from '../intelligence/anti-loop'
import { ReflexionEngine } from '../intelligence/reflexion'
import { ModelSelector } from '../models/selector'
import { ForensicLog } from '../logging/forensic-log'
import { setForensicLog } from '../tools/report-tools'
import { log } from '../utils/logger'

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
  private skillRegistry!: SkillRegistry
  private workerPool!: WorkerPool
  private evidenceGate!: EvidenceGate
  private blackboard!: Blackboard
  private loopDetector!: LoopDetector
  private reflexion?: ReflexionEngine
  private modelSelector?: ModelSelector
  private forensicLog?: ForensicLog
  private _initialized = false
  private _running = false

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

    this.skillRegistry = new SkillRegistry()
    this.skillRegistry.loadFromDirectory('skills')

    this.workerPool = new WorkerPool(this.config, this.skillRegistry)

    this.evidenceGate = new EvidenceGate()
    this.blackboard = new Blackboard({ origin: opts.target, goal: 'Session started' })
    this.loopDetector = new LoopDetector(this.config.antiLoop?.maxFailedTarget ?? 3)

    if (this.config.reflexion?.enabled !== false) {
      this.reflexion = new ReflexionEngine()
    }

    if (this.config.modelCapabilities && Object.keys(this.config.modelCapabilities).length > 0) {
      this.modelSelector = new ModelSelector(
        this.config.modelCapabilities,
        this.config.budgetPolicy,
        this.config,
      )
    }

    this._initialized = true
    log.info(`[WebEngine] Initialized for target: ${opts.target}`)
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
    const brain = createSolverBrain(this.config, {
      skillRegistry: this.skillRegistry,
      workerPool: this.workerPool,
      modelSelector: this.modelSelector,
    })

    try {
      const result = await solve(brain, {
        origin: this.target,
        goal: params.goal,
        config: params.solverConfig,
        ultimatrixConfig: this.config,
        blackboard: this.blackboard,
        evidence: this.evidenceGate,
        loopDetector: this.loopDetector,
        reflexion: this.reflexion,
        onMessage: params.onMessage,
        onPhase: params.onPhase,
      })
      return result
    } finally {
      this._running = false
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

  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry
  }

  isInitialized(): boolean {
    return this._initialized
  }

  isRunning(): boolean {
    return this._running
  }

  async destroy(): Promise<void> {
    this._initialized = false
    this._running = false
    this.forensicLog = undefined
  }
}
