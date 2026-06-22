import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { createAuthControlAgent } from '../mastra/index.js'
import { authControlInstructions } from './instructions/auth-control'
import type { UltimatrixConfig } from '../config'

export function createAuthControlWorker(config: UltimatrixConfig, browser?: StagehandBrowser, memory?: MastraMemory) {
  const agent = createAuthControlAgent(config, browser, undefined, memory)
  agent.instructions = authControlInstructions
  return agent
}
