import { Agent } from '@mastra/core/agent'
import { queryGraph, updateGraph, readAppModelSection, writeAppModelSection, recordEvidence, writeFinding, askUser, getTestCoverage, getUntestedActions, getAuthFlows, getAttackPath, getOastUrlTool, checkOastCallbacks } from '../tools/registry'
import { createDelegateToTool } from '../tools/delegate-tool'
import { supervisorInstructions } from './instructions'
import type { UltimatrixConfig } from '../config'

export function createSupervisor(config: UltimatrixConfig) {
  const modelConfig: any = config.baseUrl
    ? { id: config.model, url: config.baseUrl }
    : config.model
  const delegateToWorker = createDelegateToTool(modelConfig)

  return new Agent({
    id: 'ultimatrix-supervisor',
    name: 'Ultimatrix Security Lead',
    instructions: supervisorInstructions,
    model: modelConfig,
    tools: {
      queryGraph,
      updateGraph,
      readAppModelSection,
      writeAppModelSection,
      recordEvidence,
      writeFinding,
      askUser,
      delegateToWorker,
      getTestCoverage,
      getUntestedActions,
      getAuthFlows,
      getAttackPath,
      getOastUrlTool,
      checkOastCallbacks,
    },
  })
}