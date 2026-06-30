import type { MastraMemory } from '@mastra/core/memory'
import type { StagehandBrowser } from '@mastra/stagehand'
import { createStagehandTools } from '@mastra/stagehand'
import { createAgent } from '../mastra/index.js'
import { spiderInstructions } from './instructions'
import {
  queryGraph, getTargetSummary, getEndpointsWithParams,
  upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addAttack,
} from '../graph/tools'
import { writeFinding } from '../tools/control-tools'
import { getOastUrlTool } from '../oast/tools'
import type { UltimatrixConfig } from '../config'

export function createSpiderAgent(
  config: UltimatrixConfig,
  memory?: MastraMemory,
  browser?: StagehandBrowser,
) {
  const spiderTools: Record<string, any> = {
    // Query tools
    queryGraph,
    getTargetSummary,
    getEndpointsWithParams,
    // Focused mutation tools — clear schemas the LLM can parse
    upsertPage,
    addAction,
    addInput,
    addEndpoint,
    addAuthFlow,
    addAttack,
    addFinding,
    writeFinding,
    getOastUrlTool,
  }

  if (browser) {
    Object.assign(spiderTools, createStagehandTools(browser))
  }

  const agent = createAgent(config, {
    browser,
    memory: memory as any,
    tier: 'fast',
    tools: spiderTools,
  })

  agent.id = 'spider-agent'
  agent.name = 'Spider Crawler'
  agent.instructions = spiderInstructions

  return agent
}
