import type { SubAgent } from '@mastra/core/agent'
import { Agent } from '@mastra/core/agent'
import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import {
  httpRequest, followRedirects, omitHeader,
  queryGraph, updateGraph,
  readAppModelSection, writeAppModelSection,
  recordEvidence, writeFinding,
  askUser,
  getTestCoverage, getUntestedActions, getAuthFlows, getAttackPath,
  getOastUrlTool, checkOastCallbacks,
} from '../tools/registry'
import { createAgent } from '../mastra/index.js'
import { supervisorInstructions } from './instructions'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../skills/registry'
import type { WorkerPool } from '../workers/pool'
import { createSkillSearchTool } from './tools/skill-search'
import { createSkillLoadTool } from './tools/skill-load'
import { createSpawnWorkerTool } from './tools/spawn-worker'
import { createSpawnSwarmTool } from './tools/spawn-swarm'
import { createExecuteDirectTool } from './tools/execute-direct'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import type { StandardSchemaV1 } from '@mastra/schema-compat/schema'

export interface SupervisorOptions {
  // Dynamic mode
  skillRegistry?: SkillRegistry
  workerPool?: WorkerPool
  // Legacy mode
  workers?: Record<string, SubAgent<string>>
  // Shared
  browser?: StagehandBrowser
  memory?: MastraMemory
}

export function createSupervisor(
  config: UltimatrixConfig,
  options: SupervisorOptions,
): Agent {
  const isDynamic = options.skillRegistry && options.workerPool

  if (isDynamic) {
    const agent = createAgent(config, {
      skillRegistry: options.skillRegistry,
      workerPool: options.workerPool,
      browser: options.browser,
      memory: options.memory,
    })

    agent.id = 'ultimatrix-supervisor'
    agent.name = 'Ultimatrix Security Lead'
    agent.instructions = supervisorInstructions

    agent.tools.push(
      ...[createSkillSearchTool(options.skillRegistry!),
      createSkillLoadTool(options.skillRegistry!),
      createSpawnWorkerTool(config, options.skillRegistry!, options.workerPool!),
      createSpawnSwarmTool(config, options.skillRegistry!, options.workerPool!),
      createExecuteDirectTool()].map(tool => {
        if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in (tool.inputSchema as object)) {
          return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, config.provider) }
        }
        return tool
      }),
    )

    return agent
  }

  // Legacy mode
  const agent = createAgent(config, { browser: options.browser, memory: options.memory })

  agent.id = 'ultimatrix-supervisor'
  agent.name = 'Ultimatrix Security Lead'
  agent.instructions = supervisorInstructions
  agent.agents = options.workers as any

  return agent
}
