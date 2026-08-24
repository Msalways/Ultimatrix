import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { TaskComplexity } from '../config'
import type { SkillRegistry } from '../solver/skills/registry'
import { createAgent } from '../mastra/index'
import type { DynamicToolRegistry } from '../extensions/tool-registry'

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
  constructor(
    private config: UltimatrixConfig,
    private skillRegistry: SkillRegistry,
    _extensionRegistry?: DynamicToolRegistry,
  ) {}

  create(workerConfig: WorkerConfig): any {
    const skill = this.skillRegistry.load(workerConfig.skillId)

    const agent = createAgent(this.config, {
      browser: workerConfig.browser,
      tier: workerConfig.tier,
      modelId: workerConfig.modelId,
      role: 'worker',
      complexity: workerConfig.complexity,
      skillIds: [workerConfig.skillId],
      skills: [skill],
      taskInstructions: workerConfig.context === undefined
        ? workerConfig.task
        : `${workerConfig.task}\n\n## Runtime Task Context\n${JSON.stringify(workerConfig.context)}`,
    })

    agent.id = `${workerConfig.skillId}-${Date.now()}`
    agent.name = `${skill.name} Specialist`

    return agent
  }
}
