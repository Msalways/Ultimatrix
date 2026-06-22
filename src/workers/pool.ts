import { Agent } from '@mastra/core/agent'
import type { UltimatrixConfig } from '../config'
import { WorkerFactory, type WorkerConfig } from './factory'
import type { SkillRegistry } from '../skills/registry'

export class WorkerPool {
  private workers: Map<string, Agent> = new Map()
  private factory: WorkerFactory

  constructor(config: UltimatrixConfig, skillRegistry: SkillRegistry) {
    this.factory = new WorkerFactory(config, skillRegistry)
  }

  spawn(config: WorkerConfig): Agent {
    const worker = this.factory.create(config)
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
    const worker = this.spawn(config)
    return worker
      .generate(config.task)
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
