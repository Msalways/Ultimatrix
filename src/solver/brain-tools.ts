/**
 * Solver Brain — Orchestrator agent with focused tool set.
 *
 * Created ONCE and reused across all REPL messages.
 * The brain observes, plans, and delegates — workers do the actual testing.
 *
 * Tool set is intentionally small (~30 tools) to minimize token overhead.
 * Workers get their own skill-filtered tool sets per-task.
 * When engine is 'multi-model', brain gets selectModel tool for model-aware delegation.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { resolveModel } from '../models/factory'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import { getBrainInstructions } from './brain-instructions'
import { createSpawnWorkerTool } from '../manager/tools/spawn-worker'
import { createSpawnSwarmTool } from '../manager/tools/spawn-swarm'
import { createExecuteDirectTool } from '../manager/tools/execute-direct'
import { wrapStagehandTools } from '../browser/dialog-inject'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from './skills/registry'
import type { WorkerPool } from '../workers/pool'
import type { StandardSchemaV1 } from '@mastra/schema-compat/schema'
import { ModelSelector } from '../models/selector'

// ─── Focused tool imports ───────────────────────────────────────────
import { httpRequest, followRedirects } from '../tools/http-tools'
import { recordEvidence, writeFinding } from '../tools/control-tools'
import { askUser } from '../tools/interaction-tools'
import { detectReactions, getDialogEvidence, getRecentChanges } from '../tools/reaction-tools'
import {
  queryGraph, upsertPage, addAction, addInput,
  addEndpoint, addFinding, getTargetSummary, getEndpointsWithParams,
} from '../graph/tools'
import { loadSkillReference, searchSkillTool } from '../tools/skill-tools'
import { listSkills } from '../tools/skill-tools'
import { getCapturedHeaders, storeSession } from '../tools/har-tools'
import { getOastUrlTool } from '../oast/tools'
import { saveSession, restoreSession, observeHumanActions } from '../tools/flow-tools'

export interface SolverBrainOptions {
  skillRegistry: SkillRegistry
  workerPool: WorkerPool
  browser?: StagehandBrowser
  memory?: MastraMemory
  extraContext?: string
  modelSelector?: ModelSelector
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
    listSkills: sanitizeTool(listSkills, p),
    searchSkills: sanitizeTool(searchSkillTool, p),
    loadSkillReference: sanitizeTool(loadSkillReference, p),
  }

  // ─── Session tools (auth context) ──────────────────────────────
  const sessionTools: Record<string, any> = {
    getCapturedHeaders: sanitizeTool(getCapturedHeaders, p),
    storeSession: sanitizeTool(storeSession, p),
    saveSession: sanitizeTool(saveSession, p),
    restoreSession: sanitizeTool(restoreSession, p),
  }

  // ─── Orchestration tools (delegate to workers) ─────────────────
  const orchestrationTools: Record<string, any> = {
    spawnWorker: sanitizeTool(createSpawnWorkerTool(config, options.skillRegistry, options.workerPool), p),
    spawnSwarm: sanitizeTool(createSpawnSwarmTool(config, options.skillRegistry, options.workerPool), p),
    executeDirect: sanitizeTool(createExecuteDirectTool(config, options.skillRegistry), p),
  }

  // ─── Interaction + OAST + Reactions ──────────────────────────────
  const miscTools: Record<string, any> = {
    askUser: sanitizeTool(askUser, p),
    observeHumanActions: sanitizeTool(observeHumanActions, p),
    getOastUrl: sanitizeTool(getOastUrlTool, p),
    detectReactions: sanitizeTool(detectReactions, p),
    getDialogEvidence: sanitizeTool(getDialogEvidence, p),
    getRecentChanges: sanitizeTool(getRecentChanges, p),
  }

  // ─── Model selection tool (multi-model engine only) ──────────────
  const modelSelectionTools: Record<string, any> = {}
  if (options.modelSelector || config.engine === 'multi-model') {
    const selector = options.modelSelector ?? new ModelSelector(
      config.modelCapabilities ?? {},
      config.budgetPolicy ?? { enforcement: 'soft', scope: 'session', resetOn: 'never', allocation: { brain: 0.3, workers: 0.6, spider: 0.1 }, maxModelCallsPerTask: 15, trackTokens: false },
      config,
    )
    modelSelectionTools.selectModel = sanitizeTool(createTool({
      id: 'selectModel',
      description: 'Select the optimal model for a worker task based on capabilities, budget, and rate limits',
      inputSchema: z.object({
        skillId: z.string().describe('ID of the skill'),
        taskDescription: z.string().describe('Task description'),
        complexity: z.enum(['low', 'medium', 'high', 'critical']).describe('Task complexity'),
        requiredCapabilities: z.array(z.string()).optional().describe('Required model capabilities'),
      }),
      execute: async ({ skillId, taskDescription, complexity, requiredCapabilities }) => {
        const selection = selector.selectForTask({
          skillId,
          taskDescription,
          complexity,
          requiredCapabilities,
        }, 'worker')
        return { ok: true, selection, explanation: selector.explainSelection(selection, { skillId, taskDescription, complexity }) }
      },
    }), p)
  }

  // ─── Merge all focused tools ───────────────────────────────────
  const allTools: Record<string, any> = {
    ...coreTools,
    ...httpTools,
    ...skillTools,
    ...sessionTools,
    ...orchestrationTools,
    ...miscTools,
    ...modelSelectionTools,
  }

  // ─── Browser tools (wrapped with dialog evidence injection) ─────
  if (options.browser) {
    Object.assign(allTools, wrapStagehandTools(options.browser))
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
