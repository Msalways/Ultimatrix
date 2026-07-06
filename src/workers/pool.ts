import { Agent } from '@mastra/core/agent'
import type { UltimatrixConfig, ModelCapabilities } from '../config'
import { DEFAULTS } from '../config'
import { WorkerFactory, type WorkerConfig } from './factory'
import type { SkillRegistry } from '../skills/registry'
import type { StagehandBrowser } from '@mastra/stagehand'
import { ContextBudgetManager, type ContextFitParams } from '../models/context-manager'
import { log } from '../utils/logger'

export class WorkerPool {
  private workers: Map<string, Agent> = new Map()
  private factory: WorkerFactory
  private browser: StagehandBrowser | null = null
  private running = 0
  private maxConcurrency: number
  private contextManager: ContextBudgetManager | null = null

  constructor(config: UltimatrixConfig, skillRegistry: SkillRegistry, browser?: StagehandBrowser) {
    this.factory = new WorkerFactory(config, skillRegistry)
    this.browser = browser || null
    this.maxConcurrency = config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel

    if (config.modelCapabilities) {
      this.contextManager = new ContextBudgetManager(config.modelCapabilities)
    }
  }

  setBrowser(browser: StagehandBrowser): void {
    this.browser = browser
  }

  /**
   * Validate context fit before spawning a worker.
   * Returns validation result if capabilities are configured, null otherwise.
   */
  validateWorkerContext(config: WorkerConfig, modelId: string): ReturnType<ContextBudgetManager['validateContextFit']> | null {
    if (!this.contextManager) return null
    const skill = (this.factory as any).skillRegistry?.get?.(config.skillId)
    return this.contextManager.validateContextFit({
      modelId,
      systemPrompt: skill?.instructions || '',
      toolSchemas: '[]',
      conversationHistory: '',
      enrichedGoal: config.task,
    })
  }

  spawn(config: WorkerConfig): Agent {
    const workerConfig = { ...config, browser: config.browser || this.browser || undefined }
    const worker = this.factory.create(workerConfig)
    this.workers.set(worker.id, worker)
    return worker
  }

  get(id: string): Agent | undefined {
    return this.workers.get(id)
  }

  list(): Agent[] {
    return Array.from(this.workers.values())
  }

  kill(id: string): void {
    this.workers.delete(id)
  }

  clear(): void {
    this.workers.clear()
  }

  async execute(config: WorkerConfig): Promise<any> {
    while (this.running >= this.maxConcurrency) {
      await new Promise(r => setTimeout(r, 100))
    }
    this.running++
    const workerConfig = { ...config, browser: config.browser || this.browser || undefined }
    const worker = this.spawn(workerConfig)
    try {
      const result = await worker.generate(workerConfig.task)
      return result
    } finally {
      this.kill(worker.id)
      this.running--
    }
  }
}
