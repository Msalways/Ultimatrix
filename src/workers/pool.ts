import { Agent } from '@mastra/core/agent'
import type {UltimatrixConfig} from '../config'
import { DEFAULTS } from '../config'
import { WorkerFactory, type WorkerConfig } from './factory'
import type { SkillRegistry } from '../solver/skills/registry'
import type { StagehandBrowser } from '@mastra/stagehand'
import { ContextBudgetManager } from '../models/context-manager'
import { ContextWindowRegistry } from '../models/context-window-registry'
import { resolveModelRef } from '../models/routing'
import { compileCapabilities } from '../capabilities/compiler'
import { buildAgentInstructions } from '../mastra/agent-instructions'
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
  private contextManager: ContextBudgetManager
  private contextWindows: ContextWindowRegistry
  /** Optional workspace used for logical tenant/sandbox isolation. */
  private workspace: WorkspaceManager | null = null
  /** Pool-level tenant/sandbox association (logical isolation namespace). */
  private tenant: string | null = null
  private sandboxId: string | null = null

  constructor(
    private readonly config: UltimatrixConfig,
    private skillRegistry: SkillRegistry,
    browser?: StagehandBrowser,
    workspace?: WorkspaceManager,
    extensionRegistry?: DynamicToolRegistry,
  ) {
    this.factory = new WorkerFactory(config, skillRegistry, extensionRegistry)
    this.browser = browser || null
    this.workspace = workspace || null
    this.maxConcurrency = Math.min(config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel, 3)

    this.contextWindows = new ContextWindowRegistry(config)
    this.contextManager = new ContextBudgetManager(config.modelCapabilities ?? {}, this.contextWindows)
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
   * F12 FIX: Pass estimated tool schemas instead of empty '[]' so validation
   * accurately reflects the real worker prompt size.
   */
  validateWorkerContext(config: WorkerConfig, modelId: string): ReturnType<ContextBudgetManager['validateContextFit']> | null {
    const route = resolveModelRef(this.config, {
      modelId: config.modelId || modelId || undefined,
      tier: config.tier,
      role: 'worker',
      complexity: config.complexity,
    })
    const selectedModelId = route.modelId || route.model
    if (!this.contextWindows.resolve(selectedModelId) && !this.contextWindows.resolve(route.model)) {
      return {
        fits: false,
        reason: `No context-window and output limit metadata is registered for selected worker model ${selectedModelId}.`,
        totalInputTokens: 0,
        availableForOutput: 0,
        breakdown: { system: 0, tools: 0, history: 0, goal: 0 },
        suggestions: ['Register contextWindow and maxOutputTokens for the selected model.'],
        severity: 'critical',
      }
    }
    const skill = this.skillRegistry.load(config.skillId)
    const skillInstructions = [skill.instructions, ...(skill.fragments ?? []).map(fragment => `--- ${fragment.title} ---\n${fragment.content}`)].join('\n\n')
    const runtimeContext = config.context === undefined ? '' : `## Runtime Task Context\n${JSON.stringify(config.context)}`
    const taskInstructions = runtimeContext ? `\n## Current Task\n${runtimeContext}` : ''
    const capabilities = compileCapabilities({ skillIds: [config.skillId] })
    // Match createAgent's prompt estimator: 120 tokens per active tool schema.
    // Include the scoped runPrimitive schema when the skill declares primitives.
    const activeToolCount = capabilities.tools.length + (capabilities.primitives.length > 0 ? 1 : 0)
    const toolSchemaTokens = activeToolCount * 120
    return this.contextManager.validateContextFit({
      modelId: selectedModelId,
      systemPrompt: `${buildAgentInstructions(this.config, skillInstructions, 'worker')}${taskInstructions}`,
      toolSchemas: JSON.stringify({ toolIds: capabilities.tools, scopedPrimitiveTool: capabilities.primitives.length > 0 }),
      toolSchemaTokens,
      conversationHistory: '',
      enrichedGoal: config.task,
      expectedOutputTokens: route.maxOutputTokens,
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
    // F41 FIX: Wrap the worker agent with WorkerContext so its tool calls
    // emit typed worker:* events visible to the stream. Previously worker
    // execution was opaque — tool calls showed up without attribution.
    const { WorkerContext } = await import('./worker-context')
    const workerCtx = new WorkerContext(worker.id, workerName, workerConfig.skillId, workerConfig.task)
    workerCtx.wrap(worker)
    const startTime = Date.now()
    try {
      await options.onStarted?.({ workerId: worker.id, workerName })
      const result = await worker.generate(workerConfig.task, { abortSignal: options.signal })
      return { workerId: worker.id, workerName, result, durationMs: Date.now() - startTime }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMsg = (err as Error).message ?? String(err)
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
