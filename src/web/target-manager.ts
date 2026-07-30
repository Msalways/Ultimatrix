/**
 * TargetManager — Manages per-target WebEngine instances.
 *
 * Features:
 * - TTL-based cleanup: engines destroyed after 30 minutes of no use
 * - Concurrency lock: prevents duplicate init() for same target
 * - Proper cleanup: destroy() stops browser, OAST, dialog watcher
 * - getOrCreateEngine: returns existing or creates new
 */

import { WebEngine } from './engine'
import { log } from '../utils/logger'

const ENGINE_TTL_MS = 30 * 60 * 1000 // 30 minutes

export interface TargetInfo {
  target: string
  engineId: string
  initialized: boolean
  running: boolean
}

interface ManagedEngine {
  engine: WebEngine
  lastAccessed: number
  initPromise?: Promise<void>
}

export class TargetManager {
  private engines = new Map<string, ManagedEngine>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Start periodic TTL cleanup every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanupStale(), 5 * 60 * 1000)
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref()
    }
  }

  async getOrCreateEngine(target: string): Promise<WebEngine> {
    const existing = this.engines.get(target)
    if (existing) {
      existing.lastAccessed = Date.now()
      // If init is in progress, wait for it
      if (existing.initPromise) {
        await existing.initPromise
      }
      if (!existing.engine.isInitialized()) {
        // Re-init after previous init failed
        const initPromise = existing.engine.init({ target })
        existing.initPromise = initPromise
        await initPromise
        existing.initPromise = undefined
      }
      return existing.engine
    }

    // Concurrency lock: create placeholder immediately, init async
    const engine = new WebEngine(target)
    const managed: ManagedEngine = {
      engine,
      lastAccessed: Date.now(),
    }
    this.engines.set(target, managed)

    const initPromise = engine.init({ target }).catch((err) => {
      // Remove from map if init fails
      this.engines.delete(target)
      throw err
    })
    managed.initPromise = initPromise
    await initPromise
    managed.initPromise = undefined

    log.info(`[TargetManager] Created engine for: ${target}`)
    return engine
  }

  getEngine(target: string): WebEngine | undefined {
    const managed = this.engines.get(target)
    if (managed) {
      managed.lastAccessed = Date.now()
      return managed.engine
    }
    return undefined
  }

  async listTargets(): Promise<TargetInfo[]> {
    const targets: TargetInfo[] = []
    for (const [target, managed] of this.engines) {
      targets.push({
        target,
        engineId: managed.engine.id,
        initialized: managed.engine.isInitialized(),
        running: managed.engine.isRunning(),
      })
    }
    return targets
  }

  async destroyEngine(target: string): Promise<void> {
    const managed = this.engines.get(target)
    if (managed) {
      await managed.engine.destroy()
      this.engines.delete(target)
      log.info(`[TargetManager] Destroyed engine for: ${target}`)
    }
  }

  /**
   * Destroy engines that haven't been accessed within the TTL window
   * and are not currently running a solve.
   */
  private async cleanupStale(): Promise<void> {
    const now = Date.now()
    for (const [target, managed] of this.engines) {
      const idle = now - managed.lastAccessed
      if (idle > ENGINE_TTL_MS && !managed.engine.isRunning()) {
        log.info(`[TargetManager] TTL expired for ${target} (${Math.round(idle / 60_000)} min idle)`)
        await managed.engine.destroy()
        this.engines.delete(target)
      }
    }
  }

  /**
   * Shutdown all engines and stop the cleanup timer.
   */
  async destroyAll(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    for (const [target, managed] of this.engines) {
      try {
        await managed.engine.destroy()
      } catch {
        // best-effort
      }
    }
    this.engines.clear()
  }
}

export const targetManager = new TargetManager()
