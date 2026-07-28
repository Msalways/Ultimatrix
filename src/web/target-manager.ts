import { WebEngine } from './engine'
import { log } from '../utils/logger'

export interface TargetInfo {
  target: string
  engineId: string
  initialized: boolean
  running: boolean
}

export class TargetManager {
  private engines = new Map<string, WebEngine>()

  async getOrCreateEngine(target: string): Promise<WebEngine> {
    const existing = this.engines.get(target)
    if (existing) {
      if (!existing.isInitialized()) {
        await existing.init({ target })
      }
      return existing
    }

    const engine = new WebEngine(target)
    await engine.init({ target })
    this.engines.set(target, engine)
    log.info(`[TargetManager] Created engine for: ${target}`)
    return engine
  }

  getEngine(target: string): WebEngine | undefined {
    return this.engines.get(target)
  }

  async listTargets(): Promise<TargetInfo[]> {
    const targets: TargetInfo[] = []
    for (const [target, engine] of this.engines) {
      targets.push({
        target,
        engineId: engine.id,
        initialized: engine.isInitialized(),
        running: engine.isRunning(),
      })
    }
    return targets
  }

  async destroyEngine(target: string): Promise<void> {
    const engine = this.engines.get(target)
    if (engine) {
      await engine.destroy()
      this.engines.delete(target)
      log.info(`[TargetManager] Destroyed engine for: ${target}`)
    }
  }
}

export const targetManager = new TargetManager()
