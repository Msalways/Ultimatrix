import { Agent } from '@mastra/core/agent'
import type {UltimatrixConfig} from '../config'
import { DEFAULTS } from '../config'
import { WorkerFactory, type WorkerConfig } from './factory'
import type { SkillRegistry } from '../solver/skills/registry'
import type { StagehandBrowser } from '@mastra/stagehand'
import { ContextBudgetManager } from '../models/context-manager'
import type { WorkspaceManager } from '../workspace'
import { log } from '../utils/logger'
import { emitWorkerTimeout, emitWorkerKilled } from '../events/emitter'
import type { DynamicToolRegistry } from '../extensions/tool-registry'

/**
 * Wrap a promise with a wall-clock timeout. Timer is `.unref()`'d so it doesn't
 * keep the process alive if the promise resolves first.
 */
function waitForAdmission(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Worker execution cancelled'))
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('Worker execution cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export interface ManagedWorkerInfo {
  workerId: string
  workerName: string
}

export interface ManagedWorkerResult extends ManagedWorkerInfo {
  result: any
  durationMs: number
}

export interface ManagedWorkerOptions {
  signal?: AbortSignal
  onStarted?: (worker: ManagedWorkerInfo) => void | Promise<void>
}

export class WorkerPool {
  private workers: Map<string, Agent> = new Map()
  private factory: WorkerFactory
  private browser: StagehandBrowser | null = null
  private running = 0
  private maxConcurrency: number
  private contextManager: ContextBudgetManager | null = null
  /** Optional workspace used for logical tenant/sandbox isolation. */
  private workspace: WorkspaceManager | null = null
  /** Pool-level tenant/sandbox association (logical isolation namespace). */
  private tenant: string | null = null
  private sandboxId: string | null = null

  constructor(
    config: UltimatrixConfig,
    private skillRegistry: SkillRegistry,
    browser?: StagehandBrowser,
    workspace?: WorkspaceManager,
    extensionRegistry?: DynamicToolRegistry,
  ) {
    this.factory = new WorkerFactory(config, skillRegistry, extensionRegistry)
    this.browser = browser || null
    this.workspace = workspace || null
    this.maxConcurrency = config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel

    if (config.modelCapabilities) {
      this.contextManager = new ContextBudgetManager(config.modelCapabilities)
    }
  }

  setBrowser(browser: StagehandBrowser): void {
    this.browser = browser
  }

  /** Attach a workspace to enable logical tenant/sandbox isolation. */
  setWorkspace(workspace: WorkspaceManager): void {
    this.workspace = workspace
  }

  /**
   * Associate this pool (and subsequently spawned workers) with a tenant/sandbox.
   * Logical isolation only — scopes graph store / logs / evidence under the
   * tenant namespace via WorkspaceManager.switchTenant.
   */
  setTenant(tenant: string | null, sandboxId?: string): void {
    this.tenant = tenant
    this.sandboxId = sandboxId ?? null
  }

  /**
   * Scope the pool's state namespace under an isolated tenant. Delegates to the
   * WorkspaceManager so the global graph/oast stores point at the tenant path.
   * NOTE: tenant switching mutates the pool-global state namespace.
   */
  async switchTenant(tenantId: string, sandboxId?: string): Promise<void> {
    this.tenant = tenantId
    this.sandboxId = sandboxId ?? null
    if (this.workspace) {
      await this.workspace.switchTenant(tenantId)
    } else {
      log.warn('[pool] switchTenant called but no WorkspaceManager attached; tenant isolated logically only via worker bookkeeping')
    }
  }


  /**
   * Validate context fit before spawning a worker.
   * Returns validation result if capabilities are configured, null otherwise.
   */
  validateWorkerContext(config: WorkerConfig, modelId: string): ReturnType<ContextBudgetManager['validateContextFit']> | null {
    if (!this.contextManager) return null
    const skill = this.skillRegistry.load(config.skillId)
    return this.contextManager.validateContextFit({
      modelId,
      systemPrompt: skill?.instructions || '',
      toolSchemas: '[]',
      conversationHistory: '',
      enrichedGoal: config.task,
    })
  }

  private spawn(config: WorkerConfig): Agent {
    const workerConfig = {
      ...config,
      browser: config.browser || this.browser || undefined,
      tenant: config.tenant ?? this.tenant ?? undefined,
      sandboxId: config.sandboxId ?? this.sandboxId ?? undefined,
    }
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
    const worker = this.workers.get(id)
    if (worker) {
      const workerName = (worker as any).name ?? 'Worker'
      const skillId = (worker as any).id?.split('-').slice(0, -1).join('-') ?? 'unknown'
      emitWorkerKilled(id, workerName, skillId, 'pool-remove')
    }
    this.workers.delete(id)
  }

  clear(): void {
    this.workers.clear()
  }

  /** Execute one identified worker attempt and propagate cancellation into Mastra. */
  async executeManaged(config: WorkerConfig, options: ManagedWorkerOptions = {}): Promise<ManagedWorkerResult> {
    while (this.running >= this.maxConcurrency) await waitForAdmission(100, options.signal)
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Worker execution cancelled')
    this.running++
    const workerConfig: WorkerConfig = {
      ...config,
      browser: config.browser || this.browser || undefined,
      tenant: config.tenant ?? this.tenant ?? undefined,
      sandboxId: config.sandboxId ?? this.sandboxId ?? undefined,
    }
    const worker = this.spawn(workerConfig)
    const workerName = (worker as any).name ?? `${workerConfig.skillId} Specialist`
    const startTime = Date.now()
    try {
      await options.onStarted?.({ workerId: worker.id, workerName })
      const result = await worker.generate(workerConfig.task, { abortSignal: options.signal })
      return { workerId: worker.id, workerName, result, durationMs: Date.now() - startTime }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMsg = (err as Error).message ?? String(err)
      // Detect timeout specifically
      if (errorMsg.includes('exceeded') && errorMsg.includes('ms')) {
        emitWorkerTimeout(worker.id, workerName, workerConfig.skillId, workerConfig.task, workerConfig.timeoutMs ?? 0, durationMs)
      }

      throw err
    } finally {
      this.workers.delete(worker.id)
      this.running--
    }
  }

}
