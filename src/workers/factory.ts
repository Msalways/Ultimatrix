import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../skills/registry'
import { createAgent } from '../mastra/index.js'
import { loadSkill } from '../skills/loader'
import { CORE_CONTRACT } from '../prompts/core-contract'

export interface WorkerConfig {
  skillId: string
  task: string
  tier?: 'fast' | 'balanced' | 'powerful'
  context?: any
  browser?: StagehandBrowser
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
