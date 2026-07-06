import type { MastraMemory } from '@mastra/core/memory'
import type { StagehandBrowser } from '@mastra/stagehand'
import { wrapStagehandTools } from '../browser/dialog-inject'
import { createAgent } from '../mastra/index.js'
import { spiderInstructions } from './instructions'
import {
  queryGraph, getTargetSummary, getEndpointsWithParams,
  upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addAttack,
} from '../graph/tools'
import { writeFinding } from '../tools/control-tools'
import { getOastUrlTool } from '../oast/tools'
import { detectReactions, getDialogEvidence, getRecentChanges } from '../tools/reaction-tools'
import { recordEvidence } from '../tools/control-tools'
import { askUser } from '../tools/interaction-tools'
import { saveSession } from '../tools/flow-tools'
import { loadSkillReference, searchSkillTool } from '../tools/skill-tools'
import { encodeDecode } from '../tools/encode-decode'
import { httpRequest } from '../tools/http-tools'
import { findEndpointsInResponse } from '../tools/observation-tools'
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
    // Reaction detection — know what happens after every browser action
    detectReactions,
    getDialogEvidence,
    getRecentChanges,
    recordEvidence,
    // Additional discovery tools
    findEndpointsInResponse,
    httpRequest,
    // Human-in-the-loop
    askUser,
    // Session persistence
    saveSession,
    // Skill tools
    loadSkillReference,
    searchSkillTool,
    // Encode/decode
    encodeDecode,
  }

  if (browser) {
    Object.assign(spiderTools, wrapStagehandTools(browser))
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
