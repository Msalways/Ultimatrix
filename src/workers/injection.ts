import { Agent } from '@mastra/core/agent'
import type { MastraLanguageModel } from '@mastra/core/agent'
import type { MastraMemory } from '@mastra/core/memory'
import type { AgentBrowser } from '@mastra/agent-browser'
import {
  httpRequest, injectInContext, parseResponse, measureTiming,
  evaluateRendered, checkWaf, followRedirects, findEndpointsInResponse,
  omitHeader, updateGraph,
  stagehandAct, stagehandExtract,
  getOastUrlTool, checkOastCallbacks,
} from '../tools/registry'
import { injectionInstructions } from './instructions/injection'
import { ActionRecorder } from '../recorder/index'
import { wrapAllMastraTools } from '../recorder/tool-wrapper'

export function createInjectionWorker(model: MastraLanguageModel, browser?: AgentBrowser, memory?: MastraMemory, recorder?: ActionRecorder) {
  return new Agent({
    id: 'injection-worker',
    name: 'Injection Specialist',
    instructions: injectionInstructions,
    model,
    memory,
    browser,
    tools: (() => {
      const tools = {
        httpRequest, injectInContext, parseResponse, measureTiming,
        evaluateRendered, checkWaf, followRedirects, findEndpointsInResponse,
        omitHeader, updateGraph,
        stagehandAct, stagehandExtract,
        getOastUrlTool, checkOastCallbacks,
      }
      return recorder ? wrapAllMastraTools(tools, recorder) : tools
    })(),
  })
}