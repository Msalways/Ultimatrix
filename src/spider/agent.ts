import type { MastraMemory } from '@mastra/core/memory'
import type { StagehandBrowser } from '@mastra/stagehand'
import { createAgent } from '../mastra/index.js'
import { spiderInstructions } from './instructions'
import type { UltimatrixConfig } from '../config'

export function createSpiderAgent(
  config: UltimatrixConfig,
  memory?: MastraMemory,
  browser?: StagehandBrowser,
) {
  const agent = createAgent(config, {
    browser,
    memory: memory as any,
  })

  agent.id = 'spider-agent'
  agent.name = 'Spider Crawler'
  agent.instructions = spiderInstructions

  return agent
}
