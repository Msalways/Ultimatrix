import { Agent } from '@mastra/core/agent'
import type { MastraLanguageModel } from '@mastra/core/agent'
import type { MastraMemory } from '@mastra/core/memory'
import type { AgentBrowser } from '@mastra/agent-browser'
import {
  httpRequest, parseResponse, evaluateRendered,
  followRedirects, findEndpointsInResponse,
  updateGraph, recordEvidence, writeFinding, omitHeader,
  extractSessionCookie, extractCsrfToken, useSession,
  stagehandAct, stagehandExtract,
} from '../tools/registry'
import { authControlInstructions } from './instructions/auth-control'
import { ActionRecorder } from '../recorder/index'
import { wrapAllMastraTools } from '../recorder/tool-wrapper'

export function createAuthControlWorker(model: MastraLanguageModel, browser?: AgentBrowser, memory?: MastraMemory, recorder?: ActionRecorder) {
  return new Agent({
    id: 'auth-control-worker',
    name: 'Auth Control Specialist',
    instructions: authControlInstructions,
    model,
    memory,
    browser,
    tools: (() => {
      const tools = {
        httpRequest, parseResponse, evaluateRendered,
        followRedirects, findEndpointsInResponse,
        updateGraph, recordEvidence, writeFinding, omitHeader,
        extractSessionCookie, extractCsrfToken, useSession,
        stagehandAct, stagehandExtract,
      }
      return recorder ? wrapAllMastraTools(tools, recorder) : tools
    })(),
  })
}