import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { TaskComplexity } from '../config'
import type { SkillRegistry } from '../solver/skills/registry'
import { createAgent } from '../mastra/index'
import type { DynamicToolRegistry } from '../extensions/tool-registry'
import { compileCapabilities } from '../capabilities/compiler'
import { CapabilityFacade } from '../capabilities/facade'

export interface WorkerConfig {
  skillId: string
  task: string
  tier?: 'fast' | 'balanced' | 'powerful'
  modelId?: string
  complexity?: TaskComplexity
  tokenBudget?: number
  context?: any
  browser?: StagehandBrowser
  /**
   * Logical tenant/sandbox association. When set, the worker's graph store,
   * logs and evidence are scoped under the tenant namespace (see WorkspaceManager.switchTenant).
   * This is LOGICAL isolation (filesystem namespace + state scope), not OS-level container sandboxing.
   */
  tenant?: string
  sandboxId?: string
  /**
   * Per-worker LLM call timeout in ms. If the worker doesn't complete within
   * this deadline, the call is abandoned. Default: no timeout (caller decides).
   */
  timeoutMs?: number
}

export class WorkerFactory {
  private extensionRegistry?: DynamicToolRegistry

  constructor(
    private config: UltimatrixConfig,
    private skillRegistry: SkillRegistry,
    extensionRegistry?: DynamicToolRegistry,
  ) {
    // F7 FIX: Store the parent brain's extension registry so workers inherit its capabilities.
    this.extensionRegistry = extensionRegistry
  }

  create(workerConfig: WorkerConfig): any {
    const skill = this.skillRegistry.load(workerConfig.skillId)

    // F8 FIX: Pass parent brain's extension registry as extraTools so workers
    // inherit discovered/activated capabilities (MCP tools, plugins, browser tools).
    const parentTools = this.extensionRegistry?.getActiveToolset()
    const hasParentTools = parentTools && Object.keys(parentTools).length > 0

    // Phase 6: Capability Compiler — single operation that compiles the full
    // tool surface, scoped primitives, and evidence policy for this worker.
    const compiled = compileCapabilities({ skillIds: [workerConfig.skillId] })
    const facade = new CapabilityFacade(compiled)

    // Merge facade extras with parent brain tools
    const extraTools: Record<string, any> = { ...facade.getExtraTools() }
    if (hasParentTools) {
      for (const [key, tool] of Object.entries(parentTools!)) {
        // Facade extras take precedence (scoped runPrimitive beats global)
        if (!(key in extraTools)) {
          extraTools[key] = tool
        }
      }
    }

    const hasExtraTools = Object.keys(extraTools).length > 0

    const agent = createAgent(this.config, {
      browser: workerConfig.browser,
      tier: workerConfig.tier,
      modelId: workerConfig.modelId,
      role: 'worker',
      complexity: workerConfig.complexity,
      toolIds: facade.getToolIds(),
      skills: [skill],
      extraTools: hasExtraTools ? extraTools : undefined,
      // F11 FIX: Task is sent as the user prompt in pool.ts generate().
      // Only include context metadata in system instructions to avoid duplication.
      taskInstructions: workerConfig.context !== undefined
        ? `## Runtime Task Context\n${JSON.stringify(workerConfig.context)}`
        : undefined,
    })

    agent.id = `${workerConfig.skillId}-${Date.now()}`
    agent.name = `${skill.name} Specialist`

    return agent
  }
}
