import { Agent } from '@mastra/core/agent'
import type { UltimatrixConfig } from '../config'
import { WorkerFactory, type WorkerConfig } from './factory'
import type { SkillRegistry } from '../skills/registry'
import type { StagehandBrowser } from '@mastra/stagehand'

export class WorkerPool {
  private workers: Map<string, Agent> = new Map()
  private factory: WorkerFactory
  private browser: StagehandBrowser | null = null

  constructor(config: UltimatrixConfig, skillRegistry: SkillRegistry, browser?: StagehandBrowser) {
    this.factory = new WorkerFactory(config, skillRegistry)
    this.browser = browser || null
  }

  setBrowser(browser: StagehandBrowser): void {
    this.browser = browser
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

  execute(config: WorkerConfig): Promise<any> {
    const workerConfig = { ...config, browser: config.browser || this.browser || undefined }
    const worker = this.spawn(workerConfig)
    return worker
      .generate(workerConfig.task)
      .then((result: any) => {
        this.kill(worker.id)
        return result
      })
      .catch((err: any) => {
        this.kill(worker.id)
        throw err
      })
  }
}
