import { Agent } from '@mastra/core/agent'
import type { MastraLanguageModel } from '@mastra/core/agent'
import type { MastraMemory } from '@mastra/core/memory'
import type { AgentBrowser } from '@mastra/agent-browser'
import {
  httpRequest, parseResponse, evaluateRendered,
  followRedirects, findEndpointsInResponse,
  updateGraph, recordEvidence,
  stagehandAct, stagehandExtract,
  runRecon, frameworkFingerprint, graphqlIntrospect, jwtDecode, cloudMetadataProbe,
} from '../tools/registry'
import { reconInstructions } from './instructions/recon'
import { ActionRecorder } from '../recorder/index'
import { wrapAllMastraTools } from '../recorder/tool-wrapper'

export function createReconWorker(model: MastraLanguageModel, browser?: AgentBrowser, memory?: MastraMemory, recorder?: ActionRecorder) {
  return new Agent({
    id: 'recon-worker',
    name: 'Reconnaissance Specialist',
    instructions: reconInstructions,
    model,
    memory,
    browser,
    tools: (() => {
      const tools = {
        httpRequest, parseResponse, evaluateRendered,
        followRedirects, findEndpointsInResponse,
        updateGraph, recordEvidence,
        stagehandAct, stagehandExtract,
        runRecon, frameworkFingerprint, graphqlIntrospect, jwtDecode, cloudMetadataProbe,
      }
      return recorder ? wrapAllMastraTools(tools, recorder) : tools
    })(),
  })
}