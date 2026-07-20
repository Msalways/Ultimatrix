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
import { log } from '../utils/logger'

// ─── Focused tool imports ───────────────────────────────────────────
import { httpRequest, followRedirects } from '../tools/http-tools'
import { recordEvidence, writeFinding } from '../tools/control-tools'
import { askUser } from '../tools/interaction-tools'
import { detectReactions, getDialogEvidence, getRecentChanges } from '../tools/reaction-tools'
import {
  queryGraph, upsertPage, addAction, addInput,
  addEndpoint, addFinding, getTargetSummary, getEndpointsWithParams,
} from '../graph/tools'
import { verifyChainsTool } from '../tools/detect-chains-tool'
import { loadSkillReference, searchSkillTool } from '../tools/skill-tools'
import { listSkills } from '../tools/skill-tools'
import { listToolsTool, loadToolTool, getAcquiredToolMap } from '../extensions/tool-tools'
import { runPrimitiveTool } from '../primitives'
import { createCampaignTool } from '../campaign/campaign-tool'
import { getCapturedHeaders, storeSession } from '../tools/har-tools'
import { useSession, extractSessionCookie } from '../tools/session-tools'
import { getOastUrlTool, checkOastCallbacks } from '../oast/tools'
import { saveSession, restoreSession, observeHumanActions } from '../tools/flow-tools'
import { recordOutcomeTool } from '../intelligence/outcome-feedback'
import {
  buildResearchMap,
  planResearchExperiments,
  compareResearchResponses,
  recordFindingCandidate,
  assessCandidateReportability,
  getResearchStatus,
} from '../tools/research-tools'
import { CrossEngagementMemory } from '../intelligence/cross-engagement'
import { getGlobalObserver, type AuthState } from '../capture/human-observer'

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
    verifyChains: sanitizeTool(verifyChainsTool, p),
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

  // ─── Extension discovery tools (Phase 3) ───────────────────────
  const discoveryTools: Record<string, any> = {
    listTools: sanitizeTool(listToolsTool, p),
    loadTool: sanitizeTool(loadToolTool, p),
  }

  // Research tools (v9 bug-bounty brain): workflows -> hypotheses -> experiments -> candidates.
  const researchTools: Record<string, any> = {
    buildResearchMap: sanitizeTool(buildResearchMap, p),
    planResearchExperiments: sanitizeTool(planResearchExperiments, p),
    compareResearchResponses: sanitizeTool(compareResearchResponses, p),
    recordFindingCandidate: sanitizeTool(recordFindingCandidate, p),
    assessCandidateReportability: sanitizeTool(assessCandidateReportability, p),
    getResearchStatus: sanitizeTool(getResearchStatus, p),
  }

  // ─── Session tools (auth context) ──────────────────────────────
  const sessionTools: Record<string, any> = {
    getCapturedHeaders: sanitizeTool(getCapturedHeaders, p),
    storeSession: sanitizeTool(storeSession, p),
    saveSession: sanitizeTool(saveSession, p),
    restoreSession: sanitizeTool(restoreSession, p),
    // W2 cross-cut: let the brain persist a recovered session (from authBypass's
    // sessionArtifact) and retrieve it as headers for downstream reuse — the
    // seam that lets the exploitation loop pivot with a held session.
    useSession: sanitizeTool(useSession, p),
    extractSessionCookie: sanitizeTool(extractSessionCookie, p),
  }

  // ─── Auth flow tools (autonomous auth detection) ──────────────────
  const detectAuthFlowsTool = createTool({
    id: 'detectAuthFlows',
    description: 'Scan the current page for login forms, OAuth buttons, SAML redirects, and session tokens. Returns structured auth state including form fields, providers, and login endpoint.',
    inputSchema: z.object({
      url: z.string().optional().describe('URL to navigate to before scanning (optional — scans current page if omitted)'),
    }),
    execute: async ({ url }) => {
      const page = options.browser?.page?.()
      if (!page) return { ok: false, error: 'No active browser page' }

      try {
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
        }

        const observer = getGlobalObserver()
        const detector = observer.getAuthDetector()
        const state = await detector.detectAuthState(page as any)

        const result: Record<string, unknown> = {
          ok: true,
          hasLoginForm: state.hasLoginForm,
          authType: state.authType,
          hasPasswordField: state.hasPasswordField,
          hasRememberMe: state.hasRememberMe,
          formCount: state.formCount,
          oauthProviders: state.oauthProviders,
        }
        if (state.loginEndpoint) result.loginEndpoint = state.loginEndpoint

        return result
      } catch (error) {
        return { ok: false, error: `Auth detection failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })

  const testSessionValidTool = createTool({
    id: 'testSessionValid',
    description: 'Test if the current session is authenticated by sending a request to the target and checking for redirects to login pages or presence of login forms. Returns whether the session is valid.',
    inputSchema: z.object({
      testUrl: z.string().optional().describe('URL to test (defaults to target)'),
      protectedPaths: z.array(z.string()).optional().describe('Paths that require auth (e.g. ["/dashboard", "/api/me"])'),
    }),
    execute: async ({ testUrl, protectedPaths }) => {
      const page = options.browser?.page?.()
      if (!page) return { ok: false, error: 'No active browser page' }

      const targetUrl = testUrl || config.target || ''
      const paths = protectedPaths || ['/dashboard', '/api/me', '/profile', '/account']

      const results: Array<{ path: string; authenticated: boolean; reason?: string }> = []

      for (const path of paths) {
        const url = path.startsWith('http') ? path : `${targetUrl}${path}`
        try {
          const response = await (page as any).goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
          const finalUrl = (page as any).url?.() || ''

          const loginPatterns = [/\/login/i, /\/signin/i, /\/auth\/login/i, /\/sso/i, /session\/new/i]
          const isLoginPage = loginPatterns.some(p => p.test(finalUrl))

          if (isLoginPage) {
            results.push({ path, authenticated: false, reason: `Redirected to login: ${finalUrl}` })
            continue
          }

          const hasPwField = await (page as any).$('input[type="password"]').catch(() => null)
          if (hasPwField) {
            results.push({ path, authenticated: false, reason: 'Page contains password field' })
            continue
          }

          const status = response?.status?.() || 200
          if (status === 401 || status === 403) {
            results.push({ path, authenticated: false, reason: `HTTP ${status}` })
            continue
          }

          results.push({ path, authenticated: true })
        } catch (error) {
          results.push({ path, authenticated: false, reason: `Request failed: ${error instanceof Error ? error.message : String(error)}` })
        }
      }

      const allAuthenticated = results.every(r => r.authenticated)
      const anyAuthenticated = results.some(r => r.authenticated)

      return {
        ok: true,
        authenticated: allAuthenticated,
        partiallyAuthenticated: anyAuthenticated && !allAuthenticated,
        results,
      }
    },
  })

  const authTools: Record<string, any> = {
    detectAuthFlows: sanitizeTool(detectAuthFlowsTool, p),
    testSessionValid: sanitizeTool(testSessionValidTool, p),
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
    checkOastCallbacks: sanitizeTool(checkOastCallbacks, p),
    detectReactions: sanitizeTool(detectReactions, p),
    getDialogEvidence: sanitizeTool(getDialogEvidence, p),
    getRecentChanges: sanitizeTool(getRecentChanges, p),
    recordOutcome: sanitizeTool(recordOutcomeTool, p),
    generateReport: sanitizeTool(createTool({
      id: 'generateReport',
      description: 'Write a Markdown report to disk on demand. scope "engagement" covers all findings; scope "finding" (with findingId) reports a single bug. Returns the file path. The report includes real exploit proofs (request/response/impact) when present, so it is a deliverable, not just a list. No vocab enumeration — findings come from the live graph.',
      inputSchema: z.object({
        scope: z.enum(['engagement', 'finding']).describe('engagement = whole report; finding = one bug'),
        findingId: z.string().optional().describe('Required when scope is "finding"'),
      }),
      execute: async ({ scope, findingId }) => {
        const { writeOnDemandReport } = await import('../report/on-demand')
        const res = writeOnDemandReport(scope, findingId)
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, path: res.path, findingCount: res.findingCount }
      },
    }), p),
  }

  // ─── Council request tool (brain suggests council, user decides) ──
  const councilTools: Record<string, any> = {
    requestCouncil: sanitizeTool(createTool({
      id: 'requestCouncil',
      description: 'Suggest bringing in the council for complex decisions. The brain recommends a council deliberation when a task requires multiple perspectives or strategic debate. The user decides whether to run /council.',
      inputSchema: z.object({
        goal: z.string().describe('What the council should deliberate on'),
        reason: z.string().describe('Why council input is needed — what makes this too complex for solo reasoning'),
      }),
      execute: async ({ goal, reason }) => {
        log.info(`\n🧠 Brain suggests council deliberation:\n   Goal: ${goal}\n   Reason: ${reason}\n   → Type: /council ${goal}`)
        return { suggest: true, goal, reason }
      },
    }), p),
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
        log.info(`[model] Recommended: ${selection.modelId} (${selection.tier}) for ${complexity} task "${skillId}" — ${selection.reasoning}`)
        return { ok: true, selection, explanation: selector.explainSelection(selection, { skillId, taskDescription, complexity }) }
      },
    }), p)
  }

  // ─── Cross-engagement priors (T4.4: anonymized pattern memory) ──
  const getPriorPatternsTool = createTool({
    id: 'getPriorPatterns',
    description: 'Consult anonymized cross-engagement pattern memory to prioritize techniques, vulnerable endpoint shapes, and parameter names. Stores only structural features (path-token shapes, param names, technique ids, counts) — never raw URLs, hostnames, or target identity. Optional vulnType biases results toward a vulnerability class (e.g. "idor", "sqli").',
    inputSchema: z.object({
      vulnType: z.string().optional().describe('Optional vulnerability class to bias priors toward (e.g. "idor", "ssrf", "sqli")'),
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

  // ─── Technique primitives (Phase 2: evidence-gated security tests) ──
  const primitiveTools: Record<string, any> = {
    runPrimitive: sanitizeTool(runPrimitiveTool, p),
    getPriorPatterns: sanitizeTool(getPriorPatternsTool, p),
  }

  // ─── Campaign dispatch (Phase 2 / T2.6: strategist emits campaigns) ──
  const campaignTools: Record<string, any> = {
    runCampaign: sanitizeTool(createCampaignTool(config), p),
  }

  // ─── Merge all focused tools ───────────────────────────────────
  const allTools: Record<string, any> = {
    ...coreTools,
    ...httpTools,
    ...skillTools,
    ...discoveryTools,
    ...researchTools,
    ...sessionTools,
    ...authTools,
    ...orchestrationTools,
    ...miscTools,
    ...councilTools,
    ...primitiveTools,
    ...campaignTools,
    ...modelSelectionTools,
  }

  // Phase 1/5 — merge explicitly-acquired extension tools (MCP/plugin) into the
  // brain's active tool pack. Acquired via the loadTool discovery tool; nothing
  // is auto-loaded. Resolved tool instances are cached synchronously by loadTool.
  try {
    Object.assign(allTools, getAcquiredToolMap())
  } catch {
    /* discovery is best-effort; ignore resolution failures */
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
