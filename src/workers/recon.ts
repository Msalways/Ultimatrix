import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { createReconAgent } from '../mastra/index'
import { reconInstructions } from './instructions/recon'
import type { UltimatrixConfig } from '../config'

export function createReconWorker(config: UltimatrixConfig, browser?: StagehandBrowser, memory?: MastraMemory) {
  const agent = createReconAgent(config, browser, undefined, memory)
  ;(agent as any).instructions = reconInstructions
  return agent
}
