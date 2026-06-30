/**
 * Solver Brain — Orchestrator agent with focused tool set.
 *
 * Created ONCE and reused across all REPL messages.
 * The brain observes, plans, and delegates — workers do the actual testing.
 *
 * Tool set is intentionally small (~30 tools) to minimize token overhead.
 * Workers get their own skill-filtered tool sets per-task.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { Agent } from '@mastra/core/agent'
import { resolveModel } from '../models/factory'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import { getBrainInstructions } from './brain-instructions'
import { createSpawnWorkerTool } from '../manager/tools/spawn-worker'
import { createSpawnSwarmTool } from '../manager/tools/spawn-swarm'
import { createExecuteDirectTool } from '../manager/tools/execute-direct'
import { createStagehandTools } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../skills/registry'
import type { WorkerPool } from '../workers/pool'
import type { StandardSchemaV1 } from '@mastra/schema-compat/schema'

// ─── Focused tool imports ───────────────────────────────────────────
import { httpRequest, followRedirects } from '../tools/http-tools'
import { recordEvidence, writeFinding } from '../tools/control-tools'
import { askUser } from '../tools/interaction-tools'
import {
  queryGraph, upsertPage, addAction, addInput,
  addEndpoint, addFinding, getTargetSummary, getEndpointsWithParams,
} from '../graph/tools'
import { loadSkillReference, searchSkillTool } from '../tools/skill-tools'
import { getCapturedHeaders, storeSession } from '../tools/har-tools'
import { getOastUrlTool } from '../oast/tools'
import { saveSession } from '../tools/flow-tools'

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
 * Create the solver brain — a focused orchestrator agent.
 *
 * The brain has ~30 tools (down from 68):
 * - Core graph: observe + record
 * - Orchestration: delegate to workers
 * - HTTP: quick checks
 * - Skills: methodology search
 * - Session: auth context
 * - Browser: direct interaction
 * - OAST: blind callbacks
 *
 * Workers get their own skill-filtered tool sets per-task.
 */
export function createSolverBrain(
  config: UltimatrixConfig,
  options: SolverBrainOptions,
) {
  const p = config.provider

  // ─── Core graph tools (observe + record) ────────────────────────
  const coreTools: Record<string, any> = {
    queryGraph: sanitizeTool(queryGraph, p),
    upsertPage: sanitizeTool(upsertPage, p),
    addAction: sanitizeTool(addAction, p),
    addInput: sanitizeTool(addInput, p),
    addEndpoint: sanitizeTool(addEndpoint, p),
    addFinding: sanitizeTool(addFinding, p),
    getTargetSummary: sanitizeTool(getTargetSummary, p),
    getEndpointsWithParams: sanitizeTool(getEndpointsWithParams, p),
    writeFinding: sanitizeTool(writeFinding, p),
    recordEvidence: sanitizeTool(recordEvidence, p),
  }

  // ─── HTTP tools (quick checks) ─────────────────────────────────
  const httpTools: Record<string, any> = {
    httpRequest: sanitizeTool(httpRequest, p),
    followRedirects: sanitizeTool(followRedirects, p),
  }

  // ─── Skill tools (methodology search) ──────────────────────────
  const skillTools: Record<string, any> = {
    searchSkills: sanitizeTool(searchSkillTool, p),
    loadSkillReference: sanitizeTool(loadSkillReference, p),
  }

  // ─── Session tools (auth context) ──────────────────────────────
  const sessionTools: Record<string, any> = {
    getCapturedHeaders: sanitizeTool(getCapturedHeaders, p),
    storeSession: sanitizeTool(storeSession, p),
    saveSession: sanitizeTool(saveSession, p),
  }

  // ─── Orchestration tools (delegate to workers) ─────────────────
  const orchestrationTools: Record<string, any> = {
    spawnWorker: sanitizeTool(createSpawnWorkerTool(config, options.skillRegistry, options.workerPool), p),
    spawnSwarm: sanitizeTool(createSpawnSwarmTool(config, options.skillRegistry, options.workerPool), p),
    executeDirect: sanitizeTool(createExecuteDirectTool(config, options.skillRegistry), p),
  }

  // ─── Interaction + OAST ────────────────────────────────────────
  const miscTools: Record<string, any> = {
    askUser: sanitizeTool(askUser, p),
    getOastUrl: sanitizeTool(getOastUrlTool, p),
  }

  // ─── Merge all focused tools ───────────────────────────────────
  const allTools: Record<string, any> = {
    ...coreTools,
    ...httpTools,
    ...skillTools,
    ...sessionTools,
    ...orchestrationTools,
    ...miscTools,
  }

  // ─── Browser tools ─────────────────────────────────────────────
  if (options.browser) {
    Object.assign(allTools, createStagehandTools(options.browser))
  }

  // ─── Build agent ───────────────────────────────────────────────
  const toolCount = Object.keys(allTools).length

  const agentConfig: any = {
    name: 'ultimatrix-solver-brain',
    model: resolveModel(config),
    target: config.target,
    tools: allTools,
    instructions: getBrainInstructions(config, options.extraContext),
  }

  if (options.memory) {
    agentConfig.memory = options.memory
  }

  if (options.browser) {
    agentConfig.context = { browser: options.browser }
  }

  const agent = new Agent(agentConfig)
  agent.id = 'ultimatrix-solver-brain'
  agent.name = `Ultimatrix Solver Brain (${toolCount} tools)`

  return agent
}
