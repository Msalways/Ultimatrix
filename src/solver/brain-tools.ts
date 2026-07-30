/**
 * Solver Brain — Orchestrator agent with shared tool pack.
 *
 * Created ONCE and reused across all REPL messages.
 * The brain observes, plans, and delegates — workers do the actual testing.
 *
 * Uses buildToolPack() as the base (same as council) for tool parity,
 * then adds brain-specific extras (auth detection, council, reports,
 * extension discovery, ref-store).
 * When engine is 'multi-model', brain gets selectModel tool for model-aware delegation.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import type { MastraMemory } from '@mastra/core/memory'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { TokenLimiterProcessor } from '@mastra/core/processors'
import { z } from 'zod'
import { resolveModel } from '../models/factory'
import { ContextWindowRegistry } from '../models/context-window-registry'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import { getBrainInstructions } from './brain-instructions'
import { buildToolPack } from '../core/toolpack'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from './skills/registry'
import type { WorkerPool } from '../workers/pool'
import type { StandardSchemaWithJSON } from '@mastra/schema-compat/schema'
import { getActivePage } from '../browser/manager'
import { log } from '../utils/logger'
import { getToolResultStore } from '../graph/tool-result-store'
import { getGlobalGraphStore } from '../graph/store'
import { listToolsTool, loadToolTool, getAcquiredToolMap } from '../extensions/tool-tools'
import { CrossEngagementMemory } from '../intelligence/cross-engagement'
import { getGlobalObserver } from '../capture/human-observer'

export interface SolverBrainOptions {
  skillRegistry: SkillRegistry
  workerPool: WorkerPool
  browser?: StagehandBrowser
  memory?: MastraMemory
  extraContext?: string
  modelSelector?: import('../models/selector').ModelSelector
}

function sanitizeTool(tool: any, provider?: string): any {
  if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in (tool.inputSchema as object)) {
    return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaWithJSON, provider) }
  }
  return tool
}

/**
 * Create the solver brain — orchestrator agent with the shared tool pack.
 *
 * Base tools come from buildToolPack() (same set as council): core graph,
 * HTTP, skills, session, misc, external scanners, research, orchestration,
 * primitives, campaign, model-selection, browser.
 *
 * Brain-specific extras added on top: extension discovery, ref-store,
 * auth detection, council suggestion, on-demand report.
 */
export function createSolverBrain(
  config: UltimatrixConfig,
  options: SolverBrainOptions,
) {
  const p = config.provider

  // ─── Base tools via shared toolpack ──────────────────────────────
  // Same set as council: core (incl. getGraphSchema, getCaptureOverview,
  // queryRelations), http, skill (incl. loadSkillBody), session, misc,
  // external scanners (nuclei/sqlmap/ffuf/etc), research, orchestration,
  // primitives, campaign, model-selection, browser.
  const baseTools = buildToolPack(
    {
      config,
      skillRegistry: options.skillRegistry,
      workerPool: options.workerPool,
      browser: options.browser,
      modelSelector: options.modelSelector,
    },
    {
      includeOrchestration: true,
      includeResearch: true,
      includePrimitives: true,
    },
  )

  // ─── Brain-specific extras (not in toolpack) ────────────────────
  const brainExtras: Record<string, any> = {}

  // Extension discovery tools (MCP/plugin)
  brainExtras.listTools = sanitizeTool(listToolsTool, p)
  brainExtras.loadTool = sanitizeTool(loadToolTool, p)

  // Tool Result Ref-Store (graph-as-database for large tool outputs)
  const toolResultStore = getToolResultStore(getGlobalGraphStore())
  brainExtras.getToolResult = sanitizeTool(createTool({
    id: 'getToolResult',
    description: 'Retrieve full data from a previous tool result by its graph node reference. Use this when you need the complete response body, auth data, or other large tool output that was stored in the graph.',
    inputSchema: z.object({
      graphNodeId: z.string().describe('The graph node ID returned in a tool result bodyRef field'),
    }),
    execute: async ({ graphNodeId }) => {
      const data = toolResultStore.get(graphNodeId)
      if (!data) return { ok: false, error: `Result not found for node ${graphNodeId}` }
      return { ok: true, value: data }
    },
  }), p)

  // Auth flow tools (autonomous auth detection via browser)
  brainExtras.detectAuthFlows = sanitizeTool(createTool({
    id: 'detectAuthFlows',
    description: 'Scan the current page for login forms, OAuth buttons, SAML redirects, and session tokens. Returns structured auth state including form fields, providers, and login endpoint.',
    inputSchema: z.object({
      url: z.string().optional().describe('URL to navigate to before scanning (optional — scans current page if omitted)'),
    }),
    execute: async ({ url }) => {
      const page = getActivePage()
      if (!page) return { ok: false, error: 'No active browser page' }
      try {
        if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
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
  }), p)

  brainExtras.testSessionValid = sanitizeTool(createTool({
    id: 'testSessionValid',
    description: 'Test if the current session is authenticated by sending a request to the target and checking for redirects to login pages or presence of login forms. Returns whether the session is valid.',
    inputSchema: z.object({
      testUrl: z.string().optional().describe('URL to test (defaults to target)'),
      protectedPaths: z.array(z.string()).optional().describe('Paths that require auth (e.g. ["/dashboard", "/api/me"])'),
    }),
    execute: async ({ testUrl, protectedPaths }) => {
      const page = getActivePage()
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
          if (isLoginPage) { results.push({ path, authenticated: false, reason: `Redirected to login: ${finalUrl}` }); continue }
          const hasPwField = await (page as any).$('input[type="password"]').catch(() => null)
          if (hasPwField) { results.push({ path, authenticated: false, reason: 'Page contains password field' }); continue }
          const status = response?.status?.() || 200
          if (status === 401 || status === 403) { results.push({ path, authenticated: false, reason: `HTTP ${status}` }); continue }
          results.push({ path, authenticated: true })
        } catch (error) {
          results.push({ path, authenticated: false, reason: `Request failed: ${error instanceof Error ? error.message : String(error)}` })
        }
      }
      return {
        ok: true,
        authenticated: results.every(r => r.authenticated),
        partiallyAuthenticated: results.some(r => r.authenticated) && !results.every(r => r.authenticated),
        results,
      }
    },
  }), p)

  // Council request tool (brain suggests council, user decides)
  brainExtras.requestCouncil = sanitizeTool(createTool({
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
  }), p)

  // On-demand report generation
  brainExtras.generateReport = sanitizeTool(createTool({
    id: 'generateReport',
    description: 'Write a Markdown report to disk on demand. scope "engagement" covers all findings; scope "finding" (with findingId) reports a single bug. Returns the file path. The report includes real exploit proofs (request/response/impact) when present, so it is a deliverable, not just a list.',
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
  }), p)

  // Cross-engagement priors (anonymized pattern memory)
  brainExtras.getPriorPatterns = sanitizeTool(createTool({
    id: 'getPriorPatterns',
    description: 'Consult anonymized cross-engagement pattern memory to prioritize techniques, vulnerable endpoint shapes, and parameter names. Stores only structural features — never raw URLs, hostnames, or target identity.',
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
  }), p)

  // ─── Merge base + brain extras ─────────────────────────────────
  const allTools: Record<string, any> = { ...baseTools, ...brainExtras }

  // Merge explicitly-acquired extension tools (MCP/plugin)
  try { Object.assign(allTools, getAcquiredToolMap()) } catch {}

  // Browser tools (wrapped with dialog evidence injection) are
  // already included by buildToolPack when browser is passed.

  // ─── Build agent ───────────────────────────────────────────────
  const toolCount = Object.keys(allTools).length

  // TokenLimiter: intra-turn pruning — limit = 70% of context window
  const registry = new ContextWindowRegistry(config)
  const contextWindow = registry.getContextWindow(config.model ?? '') || 128_000
  const tokenLimit = Math.floor(contextWindow * 0.7)
  const tokenLimiter = new TokenLimiterProcessor({
    limit: tokenLimit,
    trimMode: 'best-fit',
  })

  const agentConfig: any = {
    name: 'ultimatrix-solver-brain',
    model: resolveModel(config),
    target: config.target,
    tools: allTools,
    instructions: getBrainInstructions(config, options.extraContext),
    inputProcessors: [tokenLimiter],
  }

  if (options.memory) agentConfig.memory = options.memory
  if (options.browser) agentConfig.context = { browser: options.browser }

  const agent = new Agent(agentConfig)
  agent.id = 'ultimatrix-solver-brain'
  agent.name = `Ultimatrix Solver Brain (${toolCount} tools)`

  return agent
}
