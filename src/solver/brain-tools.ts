/**
 * Solver Brain — Fully-wired security researcher agent.
 *
 * Created ONCE and reused across all REPL messages (like the supervisor).
 * Uses createAgent() with extraTools for orchestration tools — no post-construction mutation.
 *
 * The brain is NOT stripped down. It has every tool the supervisor has.
 * The difference is instructions — the brain uses conversational, organic guidance.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { createAgent } from '../mastra/index'
import { createSpawnWorkerTool } from '../manager/tools/spawn-worker'
import { createSpawnSwarmTool } from '../manager/tools/spawn-swarm'
import { createExecuteDirectTool } from '../manager/tools/execute-direct'
import { createSkillSearchTool } from '../manager/tools/skill-search'
import { createSkillLoadTool } from '../manager/tools/skill-load'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import { getBrainInstructions } from './brain-instructions'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../skills/registry'
import type { WorkerPool } from '../workers/pool'
import type { StandardSchemaV1 } from '@mastra/schema-compat/schema'

export interface SolverBrainOptions {
  skillRegistry: SkillRegistry
  workerPool: WorkerPool
  browser?: StagehandBrowser
  memory?: MastraMemory
  extraContext?: string
}

function sanitizeTool(tool: any, provider?: string): any {
  if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in (tool.inputSchema as object)) {
    return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, provider) }
  }
  return tool
}

/**
 * Create the solver brain — a fully-wired security researcher.
 *
 * Uses createAgent() for the full tool registry (HTTP, browser, graph, OAST,
 * session, recon, encoding, flow tools, etc.), then adds orchestration tools
 * (spawn-worker, spawn-swarm, execute-direct, skill-search, skill-load) via
 * extraTools — passed at construction time, no post-construction mutation.
 *
 * Overrides instructions with brain-specific conversational guidance.
 * Target URL is baked into instructions via config.target.
 */
export function createSolverBrain(
  config: UltimatrixConfig,
  options: SolverBrainOptions,
) {
  const orchestrationTools: Record<string, any> = {
    spawnWorker: sanitizeTool(createSpawnWorkerTool(config, options.skillRegistry, options.workerPool), config.provider),
    spawnSwarm: sanitizeTool(createSpawnSwarmTool(config, options.skillRegistry, options.workerPool), config.provider),
    executeDirect: sanitizeTool(createExecuteDirectTool(config, options.skillRegistry), config.provider),
    skillSearch: sanitizeTool(createSkillSearchTool(options.skillRegistry), config.provider),
    skillLoad: sanitizeTool(createSkillLoadTool(options.skillRegistry), config.provider),
  }

  const agent = createAgent(config, {
    skillRegistry: options.skillRegistry,
    workerPool: options.workerPool,
    browser: options.browser,
    memory: options.memory,
    extraTools: orchestrationTools,
  })

  agent.id = 'ultimatrix-solver-brain'
  agent.name = 'Ultimatrix Solver Brain'
  agent.instructions = getBrainInstructions(config, options.extraContext)

  return agent
}
