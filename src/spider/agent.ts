import { Agent } from '@mastra/core/agent'
import type { MastraLanguageModel } from '@mastra/core/agent'
import type { MastraMemory } from '@mastra/core/memory'
import type { AgentBrowser } from '@mastra/agent-browser'
import {
  stagehandAct, stagehandExtract,
  updateGraph,
  getOastUrlTool,
} from '../tools/registry'
import { spiderInstructions } from './instructions'

export function createSpiderAgent(model: MastraLanguageModel, browser?: AgentBrowser, memory?: MastraMemory) {
  return new Agent({
    id: 'spider-agent',
    name: 'Spider Crawler',
    instructions: spiderInstructions,
    model,
    memory,
    browser,
    tools: {
      stagehandAct, stagehandExtract,
      updateGraph,
      getOastUrlTool,
    },
  })
}