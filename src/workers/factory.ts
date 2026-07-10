import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../solver/skills/registry'
import { createAgent } from '../mastra/index.js'
import { loadSkill } from '../solver/skills/loader'
import { CORE_CONTRACT } from '../prompts/core-contract'

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
    })

    agent.id = `${workerConfig.skillId}-${Date.now()}`
    agent.name = skill ? `${skill.name} Specialist` : `${workerConfig.skillId} Specialist`

    if (skill) {
      agent.instructions = `${CORE_CONTRACT}\n\n${skill.instructions}\n\n## Current Task\n${workerConfig.task}`
    }

    return agent
  }
}
