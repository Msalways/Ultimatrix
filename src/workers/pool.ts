import { Agent } from '@mastra/core/agent'
import type {UltimatrixConfig} from '../config'
import { DEFAULTS } from '../config'
import { WorkerFactory, type WorkerConfig } from './factory'
import type { SkillRegistry } from '../solver/skills/registry'
import { loadSkill } from '../solver/skills/loader'
import type { StagehandBrowser } from '@mastra/stagehand'
import { ContextBudgetManager } from '../models/context-manager'
import type { ModelSelector, WorkerTask } from '../models/selector'
import type { WorkspaceManager } from '../workspace'
import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'
import { emitWorkerTimeout, emitWorkerKilled } from '../events/emitter'

/**
 * Wrap a promise with a wall-clock timeout. Timer is `.unref()`'d so it doesn't
 * keep the process alive if the promise resolves first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout: ${label} exceeded ${ms}ms`))
    }, ms)
  })
  if (typeof timer! === 'object' && 'unref' in timer!) timer!.unref()
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!))
}

/**
 * A unit of fan-out work for `dispatchSlices`. Each slice is routed to a model
 * via the `ModelSelector` (slice-level multi-model fan-out) and executed as a
 * specialized worker.
 */
export interface DispatchSlice {
  id: string
  skillId: string
  task: string
  complexity: 'low' | 'medium' | 'high' | 'critical'
  requiredCapabilities?: string[]
  tenant?: string
  sandboxId?: string
  context?: any
  tokenBudget?: number
}

export interface DispatchOptions {
  /** When provided, each slice is routed to a model via selectForTask(). */
  modelSelector?: ModelSelector
  /** Role passed to ModelSelector.selectForTask for every slice. */
  perSliceRole?: 'brain' | 'worker' | 'spider'
  /**
   * Per-slice worker timeout in ms. Threaded into each slice's WorkerConfig.timeoutMs.
   * If a worker doesn't complete within this deadline, the slice returns an error.
   */
  perSliceTimeoutMs?: number
}

export interface DispatchResult {
  sliceId: string
  modelId?: string
  provider?: string
  tier?: string
  tenant?: string
  sandboxId?: string
  result?: any
  error?: string
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
    skillRegistry: SkillRegistry,
    browser?: StagehandBrowser,
    workspace?: WorkspaceManager,
  ) {
    this.factory = new WorkerFactory(config, skillRegistry)
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
   * NOTE: tenant switching mutates the pool-global state namespace; callers
   * dispatching a cross-tenant batch should group slices by tenant (the iterator
   * in dispatchSlices switches once per tenant grouping).
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
    const skill = loadSkill(config.skillId)
    return this.contextManager.validateContextFit({
      modelId,
      systemPrompt: skill?.instructions || '',
      toolSchemas: '[]',
      conversationHistory: '',
      enrichedGoal: config.task,
    })
  }

  spawn(config: WorkerConfig): Agent {
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

  /**
   * Execute a single worker with concurrency gating.
   * Optional `tenant`/`sandboxId` on the config (or pool-level via setTenant)
   * are threaded into the spawned worker for logical isolation bookkeeping.
   * Signature preserved (config only) — new fields are optional.
   */
  async execute(config: WorkerConfig): Promise<any> {
    while (this.running >= this.maxConcurrency) {
      await new Promise(r => setTimeout(r, 100))
    }
    this.running++
    const workerConfig: WorkerConfig = {
      ...config,
      browser: config.browser || this.browser || undefined,
      tenant: config.tenant ?? this.tenant ?? undefined,
      sandboxId: config.sandboxId ?? this.sandboxId ?? undefined,
    }
    const worker = this.spawn(workerConfig)
    const startTime = Date.now()
    try {
      let result: any
      if (workerConfig.timeoutMs) {
        result = await withTimeout(
          worker.generate(workerConfig.task),
          workerConfig.timeoutMs,
          `worker:${workerConfig.skillId}`,
        )
      } else {
        result = await worker.generate(workerConfig.task)
      }
      return result
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMsg = (err as Error).message ?? String(err)
      const workerName = (worker as any).name ?? `${workerConfig.skillId} Specialist`

      // Detect timeout specifically
      if (errorMsg.includes('exceeded') && errorMsg.includes('ms')) {
        emitWorkerTimeout(worker.id, workerName, workerConfig.skillId, workerConfig.task, workerConfig.timeoutMs ?? 0, durationMs)
      }

      throw err
    } finally {
      this.kill(worker.id)
      this.running--
    }
  }

  /**
   * Slice-level multi-model fan-out.
   *
   * For each slice this:
   *   1. Routes the slice to a model via `ModelSelector.selectForTask({ complexity, requiredCapabilities })`
   *      (skipped when no selector is supplied — falls back to config/tier model).
   *   2. Spawns the appropriate specialized worker for `skillId` with the chosen `modelId`/`tier`.
   *   3. Respect the pool's `maxConcurrency` gate (execute() serializes admission).
   *
   * Each slice may carry its own `tenant`/`sandboxId`; when present and a workspace
   * is attached, the pool switches its state namespace to that tenant before the
   * slice runs (logical multi-tenant isolation). Slices are dispatched concurrently
   * up to `maxConcurrency`; results are returned in input order.
   */
  async dispatchSlices(
    slices: DispatchSlice[],
    options: DispatchOptions = {},
  ): Promise<DispatchResult[]> {
    const role = options.perSliceRole ?? 'worker'

    const runOne = async (slice: DispatchSlice): Promise<DispatchResult> => {
      let modelId: string | undefined
      let tier: string | undefined
      let provider: string | undefined

      if (options.modelSelector) {
        const task: WorkerTask = {
          skillId: slice.skillId,
          taskDescription: slice.task,
          complexity: slice.complexity,
          requiredCapabilities: slice.requiredCapabilities,
        }
        const selection = options.modelSelector.selectForTask(task, role)
        modelId = selection.modelId
        tier = selection.tier
        provider = selection.provider
        log.info(`[pool] slice ${slice.id} → ${modelId} (${tier}) [${role}]`)

        // Forensic model-selection: record the routing decision per slice so the
        // multi-model allocation is observable and attributable to each task.
        getForensicLog()?.log({
          type: 'model-selection',
          agent: 'pool',
          tool: 'dispatchSlices',
          args: { sliceId: slice.id, complexity: slice.complexity, skillId: slice.skillId },
          metadata: { provider: provider!, modelId: modelId!, tier: tier! },
        })
      }

      // Scope state namespace to the slice's tenant if it differs from the pool tenant.
      if (slice.tenant && slice.tenant !== this.tenant && this.workspace) {
        await this.switchTenant(slice.tenant, slice.sandboxId)
      }

      const config: WorkerConfig = {
        skillId: slice.skillId,
        task: slice.task,
        tier: tier as WorkerConfig['tier'],
        modelId,
        context: slice.context,
        tokenBudget: slice.tokenBudget,
        tenant: slice.tenant ?? this.tenant ?? undefined,
        sandboxId: slice.sandboxId ?? this.sandboxId ?? undefined,
        timeoutMs: options.perSliceTimeoutMs,
      }

      try {
        const result = await this.execute(config)
        return {
          sliceId: slice.id,
          modelId,
          provider,
          tier,
          tenant: config.tenant,
          sandboxId: config.sandboxId,
          result,
        }
      } catch (err) {
        return {
          sliceId: slice.id,
          modelId,
          provider,
          tier,
          tenant: config.tenant,
          sandboxId: config.sandboxId,
          error: (err as Error).message,
        }
      }
    }

    return Promise.all(slices.map(runOne))
  }
}
