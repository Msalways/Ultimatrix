import { Agent } from '@mastra/core/agent'
import type { MastraLanguageModel } from '@mastra/core/agent'
import type { MastraMemory } from '@mastra/core/memory'
import type { AgentBrowser } from '@mastra/agent-browser'
import {
  httpRequest, parseResponse, evaluateRendered, measureTiming,
  followRedirects, findEndpointsInResponse,
  updateGraph, recordEvidence, writeFinding,
  stagehandAct, stagehandExtract,
} from '../tools/registry'
import { advancedInstructions } from './instructions/advanced'
import { ActionRecorder } from '../recorder/index'
import { wrapAllMastraTools } from '../recorder/tool-wrapper'

export function createAdvancedWorker(model: MastraLanguageModel, browser?: AgentBrowser, memory?: MastraMemory, recorder?: ActionRecorder) {
  return new Agent({
    id: 'advanced-worker',
    name: 'Advanced Attack Specialist',
    instructions: advancedInstructions,
    model,
    memory,
    browser,
    tools: (() => {
      const tools = {
        httpRequest, parseResponse, evaluateRendered, measureTiming,
        followRedirects, findEndpointsInResponse,
        updateGraph, recordEvidence, writeFinding,
        stagehandAct, stagehandExtract,
      }
      return recorder ? wrapAllMastraTools(tools, recorder) : tools
    })(),
  })
}