import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { createAdvancedAgent } from '../mastra/index'
import { advancedInstructions } from './instructions/advanced'
import type { UltimatrixConfig } from '../config'

export function createAdvancedWorker(config: UltimatrixConfig, browser?: StagehandBrowser, memory?: MastraMemory) {
  const agent = createAdvancedAgent(config, browser, undefined, memory)
  ;(agent as any).instructions = advancedInstructions
  return agent
}
