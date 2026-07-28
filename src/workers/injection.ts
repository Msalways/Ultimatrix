import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { createInjectionAgent } from '../mastra/index'
import { injectionInstructions } from './instructions/injection'
import type { UltimatrixConfig } from '../config'

export function createInjectionWorker(config: UltimatrixConfig, browser?: StagehandBrowser, memory?: MastraMemory) {
  const agent = createInjectionAgent(config, browser, undefined, memory)
  ;(agent as any).instructions = injectionInstructions
  return agent
}
