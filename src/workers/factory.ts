import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../solver/skills/registry'
import { createAgent } from '../mastra/index'
import { loadSkill } from '../solver/skills/loader'

export interface WorkerConfig {
  skillId: string
  task: string
  tier?: 'fast' | 'balanced' | 'powerful'
  modelId?: string
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
  ) {}

  create(workerConfig: WorkerConfig): any {
    const skill = loadSkill(workerConfig.skillId)

    const agent = createAgent(this.config, {
      browser: workerConfig.browser,
      tier: workerConfig.tier,
      modelId: workerConfig.modelId,
      skillIds: [workerConfig.skillId],
      skills: skill ? [skill] : undefined,
      taskInstructions: workerConfig.task,
    })

    agent.id = `${workerConfig.skillId}-${Date.now()}`
    agent.name = skill ? `${skill.name} Specialist` : `${workerConfig.skillId} Specialist`

    return agent
  }
}
