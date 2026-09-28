import type { MastraMemory } from '@mastra/core/memory'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { TokenLimiterProcessor } from '@mastra/core/processors'
import { z } from 'zod'
import { resolveModel } from '../models/factory'
import { resolveModelRef } from '../models/routing'
import { ContextWindowRegistry } from '../models/context-window-registry'
import { planAdaptiveContext, compressBrainInstructions, filterToolsToBudget } from '../models/adaptive-context'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import { getBrainInstructions } from './brain-instructions'
import { getGlobalModelRegistry } from '../models/registry'
import { buildToolPack } from '../core/toolpack'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from './skills/registry'
import type { StandardSchemaWithJSON } from '@mastra/schema-compat/schema'
import { getActivePage } from '../browser/manager'
import { isUrlInScope } from '../safety/scope-guard'
import { recordBrowserEffectEvidence } from '../tools/control-tools'
import { randomUUID } from 'node:crypto'
import { getToolResultStore } from '../graph/tool-result-store'
import { getGlobalGraphStore } from '../graph/store'
import { createExtensionTools } from '../extensions/tool-tools'
import type { DynamicToolRegistry } from '../extensions/tool-registry'
import type { LazySolverServices } from '../runtime/lazy-services'
import { CrossEngagementMemory } from '../intelligence/cross-engagement'
import { getGlobalObserver } from '../capture/human-observer'
import { readFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'

export interface SolverBrainOptions {
  skillRegistry: SkillRegistry
  memory?: MastraMemory
  extraContext?: string
  modelSelector?: import('../models/selector').ModelSelector
  extensionRegistry: DynamicToolRegistry
  lazyServices?: LazySolverServices
  /** Solver-owned reflexion; never read from a legacy/global singleton. */
  reflexion?: import('../intelligence/reflexion').ReflexionEngine
}

export interface MethodologyState {
  /** A canonical skill body has been selected for this target. */
  methodologyLoaded?: boolean
  researchMapBuilt?: boolean
  experimentPlanned?: boolean
}

function sanitizeTool(tool: any, provider?: string): any {
  if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in tool.inputSchema) {
    return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaWithJSON, provider) }
  }
  return tool
}

const READ_ONLY = new Set([
  'queryGraph', 'getTargetSummary', 'getEndpointsWithParams', 'getGraphSchema', 'getCaptureOverview',
  'queryRelations', 'getGraphNeighborhood', 'getWorkflowAround', 'traceValue', 'explainReachability', 'getUntestedWorkarounds',
  'listSkills', 'searchSkills', 'loadSkillReference', 'loadSkillBody', 'discoverSkillsForTarget', 'getCapturedHeaders',
  'getDialogEvidence', 'getRecentChanges', 'getResearchStatus', 'getPriorPatterns', 'getFailurePatterns', 'getPayloadStats', 'getToolResult', 'selectModel',
])

const BROWSER_DESCRIPTORS: Record<string, string> = {
  stagehand_navigate: 'Navigate the authorized browser session to a URL.',
  stagehand_act: 'Perform one described action in the authorized browser session.',
  stagehand_extract: 'Extract structured information from the current browser page.',
  stagehand_observe: 'Observe actionable elements on the current browser page.',
  stagehand_screenshot: 'Capture a screenshot of the current browser page.',
  stagehand_tabs: 'Inspect or change tabs in the current browser session.',
}

const WORKER_CAPABILITIES = new Set(['spawnWorker', 'spawnSwarm', 'runTaskGraph', 'executeDirect', 'runAdvancedPlaybook'])

/**
 * Tools whose output the current model cannot consume. The screenshot tool
 * returns a multimodal image part (`toModelOutput` in the browser provider);
 * offering it to a text-only endpoint hard-fails the next request with a
 * provider 500. Fail closed: without an explicit vision grant the tool is
 * withheld and the brain is told to use text inspection instead.
 */
const VISION_DEPENDENT_TOOLS = new Set(['stagehand_screenshot'])

export function resolveBrainVisionSupport(
  config: UltimatrixConfig,
  provider: string,
  model: string,
  modelId?: string,
): boolean {
  const caps = config.modelCapabilities ?? {}
  for (const key of [modelId, model, `${provider}/${model}`, modelId ? `${provider}/${modelId}` : undefined]) {
    if (typeof key === 'string' && key && caps[key]?.supportsVision !== undefined) {
      return caps[key].supportsVision === true
    }
  }
  try {
    const registry = getGlobalModelRegistry()
    if (modelId && registry.supportsCapability(provider, modelId, 'vision')) return true
    if (model && model !== modelId && registry.supportsCapability(provider, model, 'vision')) return true
  } catch { /* registry unavailable — fail closed */ }
  return false
}

export function filterToolsByVisionSupport<T extends Record<string, any>>(tools: T, hasVision: boolean): T {
  if (hasVision) return tools
  if (!Object.keys(tools).some((id) => VISION_DEPENDENT_TOOLS.has(id))) return tools
  return Object.fromEntries(Object.entries(tools).filter(([id]) => !VISION_DEPENDENT_TOOLS.has(id))) as T
}const BROWSER_DEPENDENT = new Set(['detectAuthFlows', 'testSessionValid', 'saveSession', 'restoreSession', 'useCredential', 'extractBrowserAuth', 'detectReactions', 'getDialogEvidence', 'getRecentChanges'])
const CAPTURE_DEPENDENT = new Set(['observeHumanActions'])
const OAST_DEPENDENT = new Set(['getOastUrlTool', 'checkOastCallbacks'])

// These are the engagement control-plane tools. They must be present in the
// first model turn: asking a model to discover basic graph/network state via a
// second tool-loading protocol makes the assessment dependent on perfect tool
// choreography and was observed to produce repeated "tool not found" loops.
export const BOOTSTRAP_TOOL_IDS = new Set([
  'getTargetSummary',
  'queryGraph',
  'getGraphSchema',
  'getWorkflowAround',
  'getSessionContext',
  'detectAuthFlows',
  'testSessionValid',
  'useCredential',
  'extractBrowserAuth',
  'getCaptureOverview',
  'httpRequest',
  'listCapturedRequests',
  'replayCapturedRequest',
  'writeFinding',
  // Research loop: target-specific search, hypothesis generation, and
  // baseline/mutation experiment planning must be reachable without a
  // second tool-discovery round.
  'webSearch',
  'buildResearchMap',
  'planResearchExperiments',
  'executePlannedExperiment',
  'compareResearchResponses',
  'evaluateResearchExperiment',
  'recordFindingCandidate',
  'assessCandidateReportability',
  'getResearchStatus',
  // Skill discovery is the generic replacement for target-specific hardcode:
  // identify and load applicable methodology before choosing attack tools.
  'listSkills',
  'searchSkills',
  'discoverSkillsForTarget',
  'loadSkillReference',
  'loadSkillBody',
  // Rulings. This list, not CORE_TOOLS, is what the brain actually receives on
  // turn one — verified live, twice. With the disposition tools absent here the
  // model could still reach them via loadTool, so every structural check passed,
  // yet on a casual operator correction it never needed a tool, never loaded
  // one, and merely promised to comply. A mandate that names a tool the agent
  // does not already carry is not a mandate.
  'recordDisposition',
  'getDispositions',
  // Delegation. brain.md instructs "Spawn workers only for bounded subtasks",
  // while the same file says "If a capability is not present in the current tool
  // list, do not invent its name or call it." Those two lines are only
  // reconcilable if the tool is actually present — and it was not. Verified
  // live: across 18 real runs on an authorized target, zero workers were ever
  // spawned, because the brain was told to delegate with a tool it was
  // simultaneously forbidden to call. Delegate-only-when-bounded is the right
  // policy; it needs the capability to exist.
  'spawnWorker',
  'runTaskGraph',
])

const METHODOLOGY_GATE_TOOLS = new Set([
  'httpRequest', 'listCapturedRequests', 'replayCapturedRequest', 'writeFinding',
  'executePlannedExperiment',
  'stagehand_navigate', 'stagehand_act', 'stagehand_extract', 'stagehand_observe',
  'stagehand_screenshot', 'stagehand_tabs',
  'detectAuthFlows', 'testSessionValid',
])

/**
 * Methodology protects state-changing tests, not baseline observation. A
 * target-agnostic GET/HEAD/OPTIONS request and passive browser inspection are
 * evidence collection; requiring an experiment plan for those calls deadlocks
 * the agent before it can discover the parameters needed to build a plan.
 */
function isPassiveInvocation(toolId: string, args: unknown[]): boolean {
  if (toolId === 'httpRequest') {
    const input = (args[0] && typeof args[0] === 'object' ? args[0] : {}) as Record<string, unknown>
    return ['GET', 'HEAD', 'OPTIONS'].includes(String(input.method ?? 'GET').toUpperCase())
  }
  return new Set([
    'listCapturedRequests', 'stagehand_navigate', 'stagehand_observe',
    'stagehand_extract', 'stagehand_screenshot', 'stagehand_tabs',
    'detectAuthFlows', 'testSessionValid',
  ]).has(toolId)
}

/**
 * Auto-detect target type from URL and load the appropriate methodology skill.
 * This injects structured security-testing methodology into the brain prompt
 * at creation time, so the LLM has it as a system instruction (not a tool result).
 */
function loadMethodologySkill(targetUrl: string): string {
  if (!targetUrl) return ''

  const skillsDir = pathResolve(import.meta.dirname ?? __dirname, '..', '..', 'skills', 'methodology')

  // Detect target type from URL
  const url = targetUrl.toLowerCase()
  let skillFile = 'web-methodology.md' // default

  if (url.includes('/api/') || url.includes('/graphql') || url.includes('/rest/')) {
    skillFile = 'api-methodology.md'
  } else if (
    url.includes('amazonaws.com') ||
    url.includes('azure.') ||
    url.includes('googleapis.com') ||
    url.includes('cloudflare.') ||
    url.includes('.k8s.') ||
    url.includes('kubernetes')
  ) {
    skillFile = 'cloud-methodology.md'
  }

  try {
    const content = readFileSync(pathResolve(skillsDir, skillFile), 'utf-8')
    // Strip YAML frontmatter, keep only the methodology body
    const bodyStart = content.indexOf('---', 3)
    const body = bodyStart > 0 ? content.slice(bodyStart + 3).trim() : content
    return `\n\n## Security Testing Methodology\n\n${body}`
  } catch {
    return '' // Methodology is optional — don't fail brain creation
  }
}

export function createSolverBrain(config: UltimatrixConfig, options: SolverBrainOptions) {
  const provider = config.provider
  const baseTools = buildToolPack({
    config,
    skillRegistry: options.skillRegistry,
    modelSelector: options.modelSelector,
  }, { includeResearch: true, includePrimitives: true })

  const extras: Record<string, any> = {}
  const extensionTools = createExtensionTools(options.extensionRegistry)
  const toolResultStore = getToolResultStore(getGlobalGraphStore())

  extras.getToolResult = sanitizeTool(createTool({
    id: 'getToolResult',
    description: 'Retrieve a stored large tool result by its graph reference.',
    inputSchema: z.object({ graphNodeId: z.string() }),
    execute: async ({ graphNodeId }) => {
      const value = toolResultStore.get(graphNodeId)
      return value === undefined ? { ok: false, error: `Result not found for node ${graphNodeId}` } : { ok: true, value }
    },
  }), provider)

  extras.detectAuthFlows = sanitizeTool(createTool({
    id: 'detectAuthFlows',
    description: 'Inspect the current page for typed authentication state and entry points.',
    inputSchema: z.object({ url: z.string().optional() }),
    execute: async ({ url }) => {
      const page = getActivePage()
      if (!page) return { ok: false, error: 'No active browser page' }
      const actionId = randomUUID()
      const correlationToken = `browser:${actionId}`
      if (url) {
        const scope = isUrlInScope(url)
        if (!scope.allowed) return { ok: false, error: `Scope violation: ${scope.reason}` }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      }
      const currentUrl = typeof page.url === 'function' ? page.url() : undefined
      if (currentUrl && currentUrl !== 'about:blank') {
        const scope = isUrlInScope(currentUrl)
        if (!scope.allowed) return { ok: false, error: `Scope violation: ${scope.reason}` }
      }
      const state = await getGlobalObserver().getAuthDetector().detectAuthState(page as any)
      const evidence = recordBrowserEffectEvidence({
        data: 'authentication state inspected',
        label: 'detectAuthFlows',
        ...(currentUrl ? { url: currentUrl } : {}),
        effects: { authState: JSON.stringify(state) },
        correlationToken,
      })
      return { ok: true, ...state, browserAction: { actionId, correlationToken, pageUrl: currentUrl, evidenceIds: [evidence.id] } }
    },
  }), provider)

  extras.testSessionValid = sanitizeTool(createTool({
    id: 'testSessionValid',
    description: 'Check whether the current browser session can reach specified protected URLs.',
    inputSchema: z.object({ urls: z.array(z.string()).min(1) }),
    execute: async ({ urls }) => {
      const page = getActivePage()
      if (!page) return { ok: false, error: 'No active browser page' }
      const actionId = randomUUID()
      const correlationToken = `browser:${actionId}`
      const evidenceIds: string[] = []
      const results = []
      for (const url of urls) {
        const scope = isUrlInScope(url)
        if (!scope.allowed) {
          results.push({ url, error: `Scope violation: ${scope.reason}` })
          continue
        }
        try {
          const response = await (page as any).goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
          const finalUrl = (page as any).url?.() ?? url
          const evidence = recordBrowserEffectEvidence({
            data: `session reach check ${url}`,
            label: 'testSessionValid',
            url,
            effects: { finalUrl, status: String(response?.status?.() ?? 0) },
            correlationToken,
          })
          evidenceIds.push(evidence.id)
          results.push({ url, status: response?.status?.() ?? 0, finalUrl })
        } catch (error) {
          results.push({ url, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { ok: true, results, browserAction: { actionId, correlationToken, pageUrl: (page as any).url?.(), evidenceIds } }
    },
  }), provider)

  extras.generateReport = sanitizeTool(createTool({
    id: 'generateReport',
    description: 'Write an evidence-backed Markdown report for the engagement or one finding.',
    inputSchema: z.object({ scope: z.enum(['engagement', 'finding']), findingId: z.string().optional() }),
    execute: async ({ scope, findingId }) => (await import('../report/on-demand')).writeOnDemandReport(scope, findingId),
  }), provider)

  extras.getPriorPatterns = sanitizeTool(createTool({
    id: 'getPriorPatterns',
    description: 'Retrieve anonymized cross-engagement structural priors.',
    inputSchema: z.object({ vulnType: z.string().optional() }),
    execute: async ({ vulnType }) => {
      const memory = new CrossEngagementMemory()
      await memory.load()
      return { ok: true, value: memory.getPriorPatterns(vulnType) }
    },
  }), provider)

  // G7: Expose failure pattern analysis as brain tool — the brain can query
  // what categories of attacks failed and what actions to take.
  extras.getFailurePatterns = sanitizeTool(createTool({
    id: 'getFailurePatterns',
    description: 'Analyze the current session\'s failure patterns: which categories of attacks failed, how many times, and what to try instead.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const reflexion = options.reflexion
        if (!reflexion) return { ok: true, value: { patterns: [], message: 'No reflexion engine available' } }
        const patterns = reflexion.analyzeFailurePatterns()
        return {
          ok: true,
          value: {
            patterns,
            escalationLevel: reflexion.getEscalationLevel(),
            consecutiveFailures: reflexion.getConsecutiveFailures(),
            shouldReflect: reflexion.shouldReflect(),
            shouldEscalate: reflexion.shouldEscalate(),
          },
        }
      } catch {
        return { ok: true, value: { patterns: [], message: 'Failure analysis unavailable' } }
      }
    },
  }), provider)

  // G9: Expose payload effectiveness history — which payloads worked/failed
  // on this session, so the brain can learn from historical payload data.
  extras.getPayloadStats = sanitizeTool(createTool({
    id: 'getPayloadStats',
    description: 'Query historical payload effectiveness for this session. Returns which payloads worked or failed, grouped by vulnerability type.',
    inputSchema: z.object({
      vulnType: z.string().optional().describe('Optional vuln type filter (e.g. "SQL Injection", "XSS")'),
    }),
    execute: async ({ vulnType }) => {
      try {
        const { getOutcomeFeedbackStore } = await import('../intelligence/outcome-feedback')
        const store = getOutcomeFeedbackStore()
        const payloads = store.getPayloadEffectiveness(vulnType)
        return {
          ok: true,
          value: {
            total: payloads.length,
            worked: payloads.filter(p => p.worked).length,
            failed: payloads.filter(p => !p.worked).length,
            payloads: payloads.slice(0, 20),
          },
        }
      } catch {
        return { ok: true, value: { total: 0, worked: 0, failed: 0, payloads: [] } }
      }
    },
  }), provider)

  const catalog = { ...baseTools, ...extras }
  for (const [id, tool] of Object.entries(catalog)) {
    const requirements = CAPTURE_DEPENDENT.has(id)
      ? ['browser', 'capture']
      : BROWSER_DEPENDENT.has(id)
        ? ['browser']
        : OAST_DEPENDENT.has(id)
          ? ['oast']
          : []
    options.extensionRegistry.registerLazyBuiltin({
      id,
      description: String((tool as any).description ?? id),
      namespace: 'builtin',
      source: 'builtin',
      requirements,
      activity: READ_ONLY.has(id) ? 'inspect' : 'execute',
      readOnly: READ_ONLY.has(id),
    }, async () => {
      if (CAPTURE_DEPENDENT.has(id)) await options.lazyServices?.ensureCapture()
      else if (BROWSER_DEPENDENT.has(id)) await options.lazyServices?.ensureCapture()
      if (OAST_DEPENDENT.has(id)) await options.lazyServices?.ensureOast()
      return tool as any
    })
  }

  if (options.lazyServices) {
    for (const [id, description] of Object.entries(BROWSER_DESCRIPTORS)) {
      options.extensionRegistry.registerLazyBuiltin({
        id,
        description,
        namespace: 'browser',
        source: 'builtin',
        requirements: ['browser', 'capture'],
        activity: id === 'stagehand_observe' || id === 'stagehand_extract' || id === 'stagehand_screenshot' ? 'inspect' : 'browser-action',
        readOnly: id === 'stagehand_observe' || id === 'stagehand_extract' || id === 'stagehand_screenshot',
      }, async () => {
        const tool = (await options.lazyServices!.getBrowserTools())[id]
        if (!tool) throw new Error(`Browser provider does not supply ${id}`)
        return sanitizeTool(tool, provider)
      })
    }

    options.extensionRegistry.registerLazyBuiltin({
      id: 'crawlTarget',
      description: 'Discover the authorized target surface with the configured crawler and persist references to the graph and capture artifacts.',
      namespace: 'crawl',
      source: 'builtin',
      requirements: ['browser', 'capture', 'oast', 'crawl'],
      activity: 'crawl',
      readOnly: false,
    }, async () => {
      await options.lazyServices!.ensureCapture()
      return createTool({
        id: 'crawlTarget',
        description: 'Run the configured crawler against the authorized target.',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true, state: await options.lazyServices!.crawl() }),
      })
    })

    for (const id of WORKER_CAPABILITIES) {
      options.extensionRegistry.registerLazyBuiltin({
        id,
        description: `Initialize worker orchestration and activate ${id}.`,
        namespace: 'workers',
        source: 'builtin',
        requirements: ['workers'],
        activity: 'delegate',
        readOnly: false,
      }, async () => {
        const workers = await options.lazyServices!.ensureWorkers()
        const tools = buildToolPack({
          config,
          skillRegistry: options.skillRegistry,
          workerPool: workers.workerPool,
          taskCoordinator: workers.taskCoordinator,
          modelSelector: options.modelSelector,
        }, { includeOrchestration: true, includeResearch: false, includePrimitives: true })
        const tool = tools[id]
        if (!tool) throw new Error(`Worker runtime does not supply ${id}`)
        return tool
      })
    }
  }

  const lazyBrowserTools = options.lazyServices
    ? Object.fromEntries([
        ...Object.entries(BROWSER_DESCRIPTORS),
        ['crawlTarget', 'Discover the authorized target surface with the configured crawler and persist references to the graph and capture artifacts.'],
      ].map(([id, description]) => [id, createTool({
        id,
        description,
        // Browser/provider schemas are resolved lazily. Passing through the
        // object keeps the capability callable on the first turn while the
        // provider initializes and supplies its precise runtime tool.
        inputSchema: z.object({}).passthrough(),
        execute: async (args: Record<string, unknown>, context: unknown) => {
          const tool = await options.extensionRegistry.activate(id)
          return (tool as any).execute(args, context)
        },
      })]))
    : {}

  const discoveryTools = Object.fromEntries([
    ...Object.entries(extensionTools),
    ...Object.entries(catalog).filter(([id]) => BOOTSTRAP_TOOL_IDS.has(id)),
    ...Object.entries(lazyBrowserTools),
  ].map(([id, tool]) => [id, sanitizeTool(tool, provider)]))

  // Generic methodology gate: the brain must select and load applicable
  // domain knowledge before it can execute attack traffic. This prevents a
  // model from burning the turn on blind browser/HTTP actions while keeping
  // the policy target-agnostic.
  let methodologyLoaded = false
  let researchMapBuilt = false
  let experimentPlanned = false
  const setupResults = new Map<string, unknown>()
  for (const id of [
    'discoverSkillsForTarget', 'searchSkills', 'loadSkillBody',
    'buildResearchMap', 'planResearchExperiments', 'executePlannedExperiment',
  ]) {
    const tool = discoveryTools[id]
    if (!tool) continue
    const execute = tool.execute
    discoveryTools[id] = {
      ...tool,
      execute: async (...args: any[]) => {
        // Setup is deterministic and already persisted in the graph. Reusing
        // the typed result prevents a stalled model from repeatedly rebuilding
        // the same map/plan and exhausting the turn budget.
        if ((id === 'buildResearchMap' || id === 'planResearchExperiments') && setupResults.has(id)) {
          const cached = setupResults.get(id) as any
          return cached && typeof cached === 'object' ? { ...cached, reused: true } : cached
        }
        const result = await execute(...args)
        if (result?.ok !== false) {
          if (id === 'loadSkillBody') methodologyLoaded = true
          if (id === 'buildResearchMap') researchMapBuilt = true
          if (id === 'planResearchExperiments') experimentPlanned = true
          if (id === 'buildResearchMap' || id === 'planResearchExperiments') setupResults.set(id, result)
        }
        return result
      },
    }
  }
  // Keep gated tool schemas stable across Mastra steps. Providers may emit a
  // call using the previous step's tool surface; removing the schema makes a
  // registered capability look "not found" even though it is intentionally
  // blocked. Return a typed policy result instead, preserving fail-closed
  // execution while allowing the model to recover and complete setup.
  for (const id of METHODOLOGY_GATE_TOOLS) {
    const tool = discoveryTools[id]
    if (!tool) continue
    const execute = tool.execute
    discoveryTools[id] = {
      ...tool,
      description: `${String(tool.description ?? id)} (requires methodology setup before execution)`,
      execute: async (...args: any[]) => {
        if (!(methodologyLoaded && researchMapBuilt && experimentPlanned) && !isPassiveInvocation(id, args)) {
          return {
            ok: false,
            code: 'METHODOLOGY_REQUIRED',
            error: 'Complete target methodology, research map, and falsifiable experiment plan before active testing.',
            next: ['load applicable skill body', 'build research map', 'plan research experiment'],
          }
        }
        return execute(...args)
      },
    }
  }
  const listTools = discoveryTools.listTools
  if (listTools) {
    const execute = listTools.execute
    discoveryTools.listTools = {
      ...listTools,
      execute: async (...args: any[]) => {
        const result = await execute(...args)
        if (methodologyLoaded && researchMapBuilt && experimentPlanned) return result
        const tools = result?.tools
        if (!tools || typeof tools !== 'object') return result
        const filtered = {
          ...tools,
          builtin: Array.isArray(tools.builtin)
            ? tools.builtin.filter((tool: any) => !METHODOLOGY_GATE_TOOLS.has(tool.id))
            : tools.builtin,
        }
        return {
          ...result,
          tools: filtered,
          content: { type: 'text', text: JSON.stringify({ tools: filtered, connectors: result.connectors ?? [] }, null, 2) },
        }
      },
    }
  }
  // Build the adaptive plan BEFORE creating the tool function so it's scope-locked
  const modelRef = resolveModelRef(config, { role: 'brain' })
  const registry = new ContextWindowRegistry(config)
  const modelContextWindow = registry.getContextWindow(modelRef.modelId)
    || registry.getContextWindow(modelRef.model)
  // F22 FIX: No 128k fallback. Unknown models get a conservative default.
  if (!modelContextWindow && modelRef.modelId) {
    console.warn(`[context] Unknown model "${modelRef.modelId}" — brain will use conservative token sizing.`)
  }
  const contextWindow = modelContextWindow || 32_000

  // Vision gating: the screenshot tool emits a multimodal image part that a
  // text-only endpoint rejects with a provider 500, poisoning every later
  // request in the turn. Withhold it unless the brain model is granted vision
  // (user modelCapabilities entry, else the live model registry).
  const brainVision = resolveBrainVisionSupport(config, modelRef.provider, modelRef.model, modelRef.modelId)
  const visionNote = brainVision
    ? ''
    : '\n\nVisual page captures cannot be consumed by the current text-only model: rely on text inspection, never request an image capture.'

  // ─── Adaptive Brain: compress instructions to fit model ──
  // F24 FIX: Removed eager loadMethodologySkill(). Methodology is now served
  // on-demand by the skill registry when the brain calls loadSkillBody.
  // This avoids pre-anchoring behavior and consuming context before the model
  // understands the task.
  const fullBrainInstructions = getBrainInstructions(config)
  const estimateTokens = (t: string) => Math.ceil(t.split(/\s+/).filter(Boolean).length * 1.3)
  const fullInstructionTokens = estimateTokens(fullBrainInstructions)

  // Estimate tool schema tokens: each tool ≈ 60 tokens (name + description + schema shape)
  const allToolCount = Object.keys(discoveryTools).length + Object.keys(options.extensionRegistry.getActiveToolset()).length
  const estimatedToolSchemaTokens = allToolCount * 60

  const adaptivePlan = planAdaptiveContext({
    contextWindow: contextWindow || 8192,
    systemPromptTokens: fullInstructionTokens,
    toolSchemasTokens: estimatedToolSchemaTokens,
    goalTokens: 200,
    historyTokens: 0,
    reservedOutputTokens: modelRef.maxOutputTokens || 2048,
  })

  const brainInstructions = compressBrainInstructions(fullBrainInstructions + visionNote, adaptivePlan)

  const currentTools = () => ({
    ...options.extensionRegistry.getActiveToolset(),
    // Discovery wrappers are the canonical policy boundary. Active lazy
    // implementations must not overwrite methodology/scope/evidence gates.
    ...discoveryTools,
  })

  // Adaptive tool filtering: respect the tool budget computed by planAdaptiveContext.
  // Without this, prepareStep returns ALL tools every step, undoing the budget
  // and flooding small-context models with 2000+ tokens of schemas.
  const filteredCurrentTools = () => {
    const all = filterToolsByVisionSupport(currentTools(), brainVision)
    // Gated tools remain in the schema for cross-step/provider consistency;
    // their wrappers above enforce the readiness policy at execution time.
    const entries = Object.entries(all)
    if (entries.length <= adaptivePlan.toolBudget) return Object.fromEntries(entries)
    return filterToolsToBudget(entries, adaptivePlan.toolBudget)
  }

  const agent = new Agent({
    name: 'ultimatrix-solver-brain',
    model: resolveModel(config, { role: 'brain' }),
    target: config.target,
    tools: filteredCurrentTools,
    instructions: brainInstructions,
    inputProcessors: [new TokenLimiterProcessor({ limit: Math.floor(contextWindow * 0.7), trimMode: 'contiguous' })],
    // No blind transport retries. A terminal condition (bad/expired key, 403,
    // unsupported model) can never succeed on retry, and Mastra's default of 2
    // retries delays that verdict by a minute or more of backoff. Rate limiting
    // already has classified backoff in the provider-aware limiter, and
    // genuinely recoverable failures are escalated deliberately by the solver's
    // own tier fallback (isRecoverableModelFailure) — the only layer that can
    // tell a dead credential from a transient overload.
    maxRetries: 0,
    defaultOptions: {
      activeTools: Object.keys(filteredCurrentTools()),
      prepareStep: () => ({ tools: filteredCurrentTools(), activeTools: Object.keys(filteredCurrentTools()) }),
      ...(modelRef.maxOutputTokens ? { modelSettings: { maxTokens: modelRef.maxOutputTokens } } : {}),
    },
    ...(options.memory ? { memory: options.memory } : {}),
  } as any)

  agent.id = 'ultimatrix-solver-brain'
  agent.name = 'Ultimatrix Solver Brain'
  // The deterministic solver bootstrap can complete research setup before the
  // first model turn. Keep the methodology gate in sync with that runtime
  // state; otherwise the brain is forced to repeat setup that already ran.
  ;(agent as any).setMethodologyState = (state: MethodologyState) => {
    if (state.methodologyLoaded) methodologyLoaded = true
    if (state.researchMapBuilt) researchMapBuilt = true
    if (state.experimentPlanned) experimentPlanned = true
  }
  ;(agent as any).capabilityRegistry = options.extensionRegistry
  ;(agent as any).lazyServices = options.lazyServices
  ;(agent as any).getTurnToolset = filteredCurrentTools
  return agent
}

