/**
 * Shared tool-pack builder for the Execution Core.
 *
 * Both the multi-model brain and the council factory compose the same tool
 * groups (core, http, skill, research, session, orchestration, misc, browser).
 * This module centralises that logic so adding a tool to one engine doesn't
 * forget the other.
 *
 * T0.4 (Wave Core): council factory calls `buildToolPack({ includeOrchestration: true })`
 * which FINALLY adds `spawnWorker`/`spawnSwarm`/`executeDirect` — closing the
 * delegation gap the gap-analysis flagged.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../solver/skills/registry'
import type { WorkerPool } from '../workers/pool'
import type { TaskCoordinator } from '../runtime/task-coordinator'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import type { StandardSchemaWithJSON } from '@mastra/schema-compat/schema'
import { ModelSelector } from '../models/selector'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getEngagementServices } from '../runtime/engagement-context'
import { log } from '../utils/logger'

// ─── Tool imports (same as brain-tools.ts) ─────────────────────────────
import { httpRequest, followRedirects } from '../tools/http-tools'
import { listCapturedRequests, replayCapturedRequest } from '../tools/replay-tools'
import { manageSkills } from '../tools/skill-manage-tools'
import { recordEvidence, writeFinding } from '../tools/control-tools'
import { askUser } from '../tools/interaction-tools'
import { detectReactions, getDialogEvidence, getRecentChanges } from '../tools/reaction-tools'
import {
  queryGraph, upsertPage, addAction, addInput,
  addEndpoint, getTargetSummary, getEndpointsWithParams,
} from '../graph/tools'
import {
  getGraphSchema,
  getCaptureOverview,
  queryRelations,
  getGraphNeighborhood,
  getWorkflowAround,
  traceValue,
  explainReachability,
  getUntestedWorkarounds,
} from '../graph/relation-tools'
import { verifyChainsTool } from '../tools/detect-chains-tool'
import { loadSkillReference, searchSkillTool, listSkills, loadSkillBodyTool } from '../tools/skill-tools'
import { runPrimitiveTool } from '../primitives'
import { createCampaignTool } from '../campaign/campaign-tool'
import { createRunAdvancedPlaybookTool, diagnoseTargetTool } from '../orchestration/tools'
import { getCapturedHeaders, storeSession } from '../tools/har-tools'
import { scannerTools } from '../tools/scanner-tools'
import { useSession, extractSessionCookie } from '../tools/session-tools'
import { getOastUrlTool, checkOastCallbacks } from '../oast/tools'
import { saveSession, restoreSession, observeHumanActions } from '../tools/flow-tools'
import { recordOutcomeTool } from '../intelligence/outcome-feedback'
import { webSearch } from '../tools/web-search'
import {
  buildResearchMap, planResearchExperiments, compareResearchResponses,
  evaluateResearchExperiment, recordFindingCandidate, assessCandidateReportability, getResearchStatus,
} from '../tools/research-tools'
import { createSpawnWorkerTool } from '../manager/tools/spawn-worker'
import { createSpawnSwarmTool } from '../manager/tools/spawn-swarm'
import { createExecuteDirectTool } from '../manager/tools/execute-direct'
import { createRunTaskGraphTool } from '../manager/tools/run-task-graph'
import { wrapStagehandTools } from '../browser/dialog-inject'
import { CrossEngagementMemory } from '../intelligence/cross-engagement'
import { getSessionContext } from '../tools/context-tools'

// ─── Types ─────────────────────────────────────────────────────────────

export interface ToolPackOptions {
  /** Include spawnWorker / spawnSwarm / executeDirect (council operator). */
  includeOrchestration?: boolean
  /** Include research tools (v9 bug-bounty brain). */
  includeResearch?: boolean
  /** Include campaign / primitive tools. */
  includePrimitives?: boolean
  /** Include cross-engagement priors tool. */
  includePriors?: boolean
}

export interface ToolPackDeps {
  config: UltimatrixConfig
  skillRegistry: SkillRegistry
  workerPool?: WorkerPool
  browser?: StagehandBrowser
  modelSelector?: ModelSelector
  taskCoordinator?: TaskCoordinator
}

// ─── Helpers ───────────────────────────────────────────────────────────

function s(tool: any, provider?: string): any {
  if (tool?.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in (tool.inputSchema as object)) {
    return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaWithJSON, provider) }
  }
  return tool
}

// ─── Core groups ───────────────────────────────────────────────────────

function coreTools(p: string): Record<string, any> {
  return {
    queryGraph: s(queryGraph, p),
    upsertPage: s(upsertPage, p),
    addAction: s(addAction, p),
    addInput: s(addInput, p),
    addEndpoint: s(addEndpoint, p),
    getTargetSummary: s(getTargetSummary, p),
    getEndpointsWithParams: s(getEndpointsWithParams, p),
    getGraphSchema: s(getGraphSchema, p),
    getCaptureOverview: s(getCaptureOverview, p),
    queryRelations: s(queryRelations, p),
    getGraphNeighborhood: s(getGraphNeighborhood, p),
    getWorkflowAround: s(getWorkflowAround, p),
    traceValue: s(traceValue, p),
    explainReachability: s(explainReachability, p),
    getUntestedWorkarounds: s(getUntestedWorkarounds, p),
    writeFinding: s(writeFinding, p),
    recordEvidence: s(recordEvidence, p),
    verifyChains: s(verifyChainsTool, p),
    getSessionContext: s(getSessionContext, p),
  }
}

function httpTools(p: string): Record<string, any> {
  return {
    httpRequest: s(httpRequest, p),
    followRedirects: s(followRedirects, p),
    listCapturedRequests: s(listCapturedRequests, p),
    replayCapturedRequest: s(replayCapturedRequest, p),
  }
}

function skillTools(p: string): Record<string, any> {
  return {
    listSkills: s(listSkills, p),
    searchSkills: s(searchSkillTool, p),
    loadSkillReference: s(loadSkillReference, p),
    loadSkillBody: s(loadSkillBodyTool, p),
    manageSkills: s(manageSkills, p),
  }
}

function sessionTools(p: string): Record<string, any> {
  return {
    getCapturedHeaders: s(getCapturedHeaders, p),
    storeSession: s(storeSession, p),
    saveSession: s(saveSession, p),
    restoreSession: s(restoreSession, p),
    useSession: s(useSession, p),
    extractSessionCookie: s(extractSessionCookie, p),
  }
}

function miscTools(p: string): Record<string, any> {
  return {
    askUser: s(askUser, p),
    observeHumanActions: s(observeHumanActions, p),
    getOastUrlTool: s(getOastUrlTool, p),
    checkOastCallbacks: s(checkOastCallbacks, p),
    detectReactions: s(detectReactions, p),
    getDialogEvidence: s(getDialogEvidence, p),
    getRecentChanges: s(getRecentChanges, p),
    recordOutcome: s(recordOutcomeTool, p),
    webSearch: s(webSearch, p),
  }
}

function researchTools(p: string): Record<string, any> {
  return {
    buildResearchMap: s(buildResearchMap, p),
    planResearchExperiments: s(planResearchExperiments, p),
    compareResearchResponses: s(compareResearchResponses, p),
    evaluateResearchExperiment: s(evaluateResearchExperiment, p),
    recordFindingCandidate: s(recordFindingCandidate, p),
    assessCandidateReportability: s(assessCandidateReportability, p),
    getResearchStatus: s(getResearchStatus, p),
  }
}

function orchestrationTools(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  taskCoordinator: TaskCoordinator,
  p: string,
  modelSelector?: ModelSelector,
): Record<string, any> {
  return {
    spawnWorker: s(createSpawnWorkerTool(config, skillRegistry, taskCoordinator, modelSelector), p),
    spawnSwarm: s(createSpawnSwarmTool(config, skillRegistry, taskCoordinator, modelSelector), p),
    runTaskGraph: s(createRunTaskGraphTool(taskCoordinator, skillRegistry, modelSelector), p),
    executeDirect: s(createExecuteDirectTool(config, skillRegistry), p),
  }
}

function primitiveTools(p: string): Record<string, any> {
  const getPriorPatternsTool = createTool({
    id: 'getPriorPatterns',
    description: 'Consult anonymized cross-engagement pattern memory.',
    inputSchema: z.object({
      vulnType: z.string().optional().describe('Optional vulnerability class to bias priors toward'),
    }),
    execute: async ({ vulnType }) => {
      const mem = new CrossEngagementMemory()
      await mem.load()
      const priors = mem.getPriorPatterns(vulnType)
      return {
        ok: true,
        value: {
          engagementCount: priors.engagementCount,
          vulnType: priors.vulnType,
          topTechniques: priors.topTechniques,
          vulnerableShapes: priors.vulnerableShapes,
          commonParams: priors.commonParams,
          failurePatterns: priors.failurePatterns,
          effectiveSequences: priors.effectiveSequences,
          promptBlock: priors.promptBlock,
        },
      }
    },
  })

  return {
    runPrimitive: s(runPrimitiveTool, p),
    getPriorPatterns: s(getPriorPatternsTool, p),
  }
}

function campaignTools(config: UltimatrixConfig, p: string): Record<string, any> {
  return {
    runCampaign: s(createCampaignTool(config), p),
  }
}

function orchestrationLayerTools(p: string, coordinator?: TaskCoordinator): Record<string, any> {
  return {
    diagnoseTarget: s(diagnoseTargetTool, p),
    ...(coordinator ? { runAdvancedPlaybook: s(createRunAdvancedPlaybookTool(coordinator), p) } : {}),
  }
}

function externalTools(config: UltimatrixConfig, p: string): Record<string, any> {
  if (config.externalTools?.enabled !== true) return {}
  const enabled = config.externalTools.tools ?? {}
  const tools = Object.keys(enabled).filter((id) => enabled[id as keyof typeof enabled])
  if (tools.length === 0) return {}
  return Object.fromEntries(
    tools
      .filter((id) => id in scannerTools)
      .map((id) => [id, s(scannerTools[id as keyof typeof scannerTools], p)]),
  )
}

function modelSelectionTools(
  config: UltimatrixConfig,
  modelSelector?: ModelSelector,
): Record<string, any> {
  if (!modelSelector && config.engine !== 'multi-model') return {}

  // F2 — one canonical authority: resolve the engagement-scoped selector
  // before constructing a fresh instance (fresh instances fork cooldown/
  // quota/success state).
  const selector = modelSelector ?? getEngagementServices()?.modelSelector ?? new ModelSelector(
    config.modelCapabilities ?? {},
    config.budgetPolicy ?? {
      enforcement: 'soft', scope: 'session', resetOn: 'never',
      allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
      maxModelCallsPerTask: 15, trackTokens: false,
    },
    config,
  )

  return {
    selectModel: s(createTool({
      id: 'selectModel',
      description: 'Select the optimal model for a worker task based on capabilities, budget, and rate limits',
      inputSchema: z.object({
        skillId: z.string().describe('ID of the skill'),
        taskDescription: z.string().describe('Task description'),
        complexity: z.enum(['low', 'medium', 'high', 'critical']).describe('Task complexity'),
        requiredCapabilities: z.array(z.string()).optional().describe('Required model capabilities'),
      }),
      execute: async ({ skillId, taskDescription, complexity, requiredCapabilities }) => {
        const selection = selector.selectForTask({ skillId, taskDescription, complexity, requiredCapabilities }, 'worker')
        log.info(`[model] Recommended: ${selection.modelId} (${selection.tier}) for ${complexity} task "${skillId}" — ${selection.reasoning}`)
        return { ok: true, selection, explanation: selector.explainSelection(selection, { skillId, taskDescription, complexity }) }
      },
    }), config.provider),
  }
}

// ─── Main builder ──────────────────────────────────────────────────────

export function buildToolPack(
  deps: ToolPackDeps,
  opts: ToolPackOptions = {},
): Record<string, any> {
  const { config, skillRegistry } = deps
  const p = config.provider ?? ''

  const includeOrchestration = opts.includeOrchestration ?? false
  const includeResearch = opts.includeResearch ?? true
  const includePrimitives = opts.includePrimitives ?? true
  const includePriors = opts.includePriors ?? true

  const tools: Record<string, any> = {
    ...coreTools(p),
    ...httpTools(p),
    ...skillTools(p),
    ...sessionTools(p),
    ...miscTools(p),
    ...externalTools(config, p),
  }

  if (includeResearch) Object.assign(tools, researchTools(p))
  if (includeOrchestration) {
    if (!deps.taskCoordinator) throw new Error('TaskCoordinator is required when orchestration tools are enabled')
    Object.assign(tools, orchestrationTools(config, skillRegistry, deps.taskCoordinator, p, deps.modelSelector))
  }
  if (includePrimitives) Object.assign(tools, primitiveTools(p))
  if (includePrimitives) Object.assign(tools, campaignTools(config, p))
  if (includePrimitives) Object.assign(tools, orchestrationLayerTools(p, deps.taskCoordinator))

  Object.assign(tools, modelSelectionTools(config, deps.modelSelector))

  if (deps.browser) Object.assign(tools, wrapStagehandTools(deps.browser))

  return tools
}
