import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../skills/registry'
import { createAgent } from '../mastra/index.js'
import { resolveTools } from '../tools/resolver'

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
    const skill = this.skillRegistry.get(workerConfig.skillId)
    const tools = resolveTools(skill.toolRefs)

    const agent = createAgent(this.config, {
      browser: workerConfig.browser,
      tier: workerConfig.tier,
    })

    agent.id = `${workerConfig.skillId}-${Date.now()}`
    agent.name = `${skill.name} Specialist`
    agent.instructions = `${skill.instructions}

## Current Task
${workerConfig.task}`
    agent.tools = tools

    return agent
  }
}
