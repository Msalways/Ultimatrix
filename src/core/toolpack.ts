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
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import type { StandardSchemaV1 } from '@mastra/schema-compat/schema'
import { ModelSelector } from '../models/selector'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { log } from '../utils/logger'

// ─── Tool imports (same as brain-tools.ts) ─────────────────────────────
import { httpRequest, followRedirects } from '../tools/http-tools'
import { recordEvidence, writeFinding } from '../tools/control-tools'
import { askUser } from '../tools/interaction-tools'
import { detectReactions, getDialogEvidence, getRecentChanges } from '../tools/reaction-tools'
import {
  queryGraph, upsertPage, addAction, addInput,
  addEndpoint, addFinding, getTargetSummary, getEndpointsWithParams,
} from '../graph/tools'
import { getGraphSchema, getCaptureOverview, queryRelations } from '../graph/relation-tools'
import { verifyChainsTool } from '../tools/detect-chains-tool'
import { loadSkillReference, searchSkillTool, listSkills } from '../tools/skill-tools'
import { runPrimitiveTool } from '../primitives'
import { createCampaignTool } from '../campaign/campaign-tool'
import { getCapturedHeaders, storeSession } from '../tools/har-tools'
import { getOastUrlTool, checkOastCallbacks } from '../oast/tools'
import { saveSession, restoreSession, observeHumanActions } from '../tools/flow-tools'
import { recordOutcomeTool } from '../intelligence/outcome-feedback'
import {
  buildResearchMap, planResearchExperiments, compareResearchResponses,
  recordFindingCandidate, assessCandidateReportability, getResearchStatus,
} from '../tools/research-tools'
import { createSpawnWorkerTool } from '../manager/tools/spawn-worker'
import { createSpawnSwarmTool } from '../manager/tools/spawn-swarm'
import { createExecuteDirectTool } from '../manager/tools/execute-direct'
import { wrapStagehandTools } from '../browser/dialog-inject'
import { CrossEngagementMemory } from '../intelligence/cross-engagement'

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
  workerPool: WorkerPool
  browser?: StagehandBrowser
  modelSelector?: ModelSelector
}

// ─── Helpers ───────────────────────────────────────────────────────────

function s(tool: any, provider?: string): any {
  if (tool?.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in (tool.inputSchema as object)) {
    return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, provider) }
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
    addFinding: s(addFinding, p),
    getTargetSummary: s(getTargetSummary, p),
    getEndpointsWithParams: s(getEndpointsWithParams, p),
    getGraphSchema: s(getGraphSchema, p),
    getCaptureOverview: s(getCaptureOverview, p),
    queryRelations: s(queryRelations, p),
    writeFinding: s(writeFinding, p),
    recordEvidence: s(recordEvidence, p),
    verifyChains: s(verifyChainsTool, p),
  }
}

function httpTools(p: string): Record<string, any> {
  return {
    httpRequest: s(httpRequest, p),
    followRedirects: s(followRedirects, p),
  }
}

function skillTools(p: string): Record<string, any> {
  return {
    listSkills: s(listSkills, p),
    searchSkills: s(searchSkillTool, p),
    loadSkillReference: s(loadSkillReference, p),
  }
}

function sessionTools(p: string): Record<string, any> {
  return {
    getCapturedHeaders: s(getCapturedHeaders, p),
    storeSession: s(storeSession, p),
    saveSession: s(saveSession, p),
    restoreSession: s(restoreSession, p),
  }
}

function miscTools(p: string): Record<string, any> {
  return {
    askUser: s(askUser, p),
    observeHumanActions: s(observeHumanActions, p),
    getOastUrl: s(getOastUrlTool, p),
    checkOastCallbacks: s(checkOastCallbacks, p),
    detectReactions: s(detectReactions, p),
    getDialogEvidence: s(getDialogEvidence, p),
    getRecentChanges: s(getRecentChanges, p),
    recordOutcome: s(recordOutcomeTool, p),
  }
}

function researchTools(p: string): Record<string, any> {
  return {
    buildResearchMap: s(buildResearchMap, p),
    planResearchExperiments: s(planResearchExperiments, p),
    compareResearchResponses: s(compareResearchResponses, p),
    recordFindingCandidate: s(recordFindingCandidate, p),
    assessCandidateReportability: s(assessCandidateReportability, p),
    getResearchStatus: s(getResearchStatus, p),
  }
}

function orchestrationTools(
  config: UltimatrixConfig,
  skillRegistry: SkillRegistry,
  workerPool: WorkerPool,
  p: string,
): Record<string, any> {
  return {
    spawnWorker: s(createSpawnWorkerTool(config, skillRegistry, workerPool), p),
    spawnSwarm: s(createSpawnSwarmTool(config, skillRegistry, workerPool), p),
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

function modelSelectionTools(
  config: UltimatrixConfig,
  modelSelector?: ModelSelector,
): Record<string, any> {
  if (!modelSelector && config.engine !== 'multi-model') return {}

  const selector = modelSelector ?? new ModelSelector(
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
  const { config, skillRegistry, workerPool } = deps
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
  }

  if (includeResearch) Object.assign(tools, researchTools(p))
  if (includeOrchestration) Object.assign(tools, orchestrationTools(config, skillRegistry, workerPool, p))
  if (includePrimitives) Object.assign(tools, primitiveTools(p))
  if (includePrimitives) Object.assign(tools, campaignTools(config, p))

  Object.assign(tools, modelSelectionTools(config, deps.modelSelector))

  if (deps.browser) Object.assign(tools, wrapStagehandTools(deps.browser))

  return tools
}
