import type { SubAgent } from '@mastra/core/agent'
import { Agent } from '@mastra/core/agent'
import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { createAgent } from '../mastra/index'
import { supervisorInstructions } from './instructions'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../solver/skills/registry'
import type { WorkerPool } from '../workers/pool'
import { createSpawnWorkerTool } from './tools/spawn-worker'
import { createSpawnSwarmTool } from './tools/spawn-swarm'
import { createExecuteDirectTool } from './tools/execute-direct'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import type { StandardSchemaWithJSON } from '@mastra/schema-compat/schema'

function sanitizeOrchTool(tool: any, provider?: string): any {
  if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in (tool.inputSchema as object)) {
    return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaWithJSON, provider) }
  }
  return tool
}

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
    const orchestrationTools: Record<string, any> = {
      spawnWorker: sanitizeOrchTool(createSpawnWorkerTool(config, options.skillRegistry!, options.workerPool!), config.provider),
      spawnSwarm: sanitizeOrchTool(createSpawnSwarmTool(config, options.skillRegistry!, options.workerPool!), config.provider),
      executeDirect: sanitizeOrchTool(createExecuteDirectTool(config, options.skillRegistry!), config.provider),
    }

    const agent = createAgent(config, {
      skillRegistry: options.skillRegistry,
      workerPool: options.workerPool,
      browser: options.browser,
      memory: options.memory,
      extraTools: orchestrationTools,
    })

    agent.id = 'ultimatrix-supervisor'
    agent.name = 'Ultimatrix Security Lead'
    ;(agent as any).instructions = supervisorInstructions

    return agent
  }

  // Legacy mode
  const agent = createAgent(config, { browser: options.browser, memory: options.memory })

  agent.id = 'ultimatrix-supervisor'
  agent.name = 'Ultimatrix Security Lead'
  ;(agent as any).instructions = supervisorInstructions
  ;(agent as any).agents = options.workers as any

  return agent
}
