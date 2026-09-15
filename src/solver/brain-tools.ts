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
import { buildToolPack } from '../core/toolpack'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from './skills/registry'
import type { StandardSchemaWithJSON } from '@mastra/schema-compat/schema'
import { getActivePage } from '../browser/manager'
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
  'listSkills', 'searchSkills', 'loadSkillReference', 'loadSkillBody', 'getCapturedHeaders',
  'getDialogEvidence', 'getRecentChanges', 'getResearchStatus', 'getPriorPatterns', 'getToolResult', 'selectModel',
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
const BROWSER_DEPENDENT = new Set(['detectAuthFlows', 'testSessionValid', 'saveSession', 'restoreSession', 'detectReactions', 'getDialogEvidence', 'getRecentChanges'])
const CAPTURE_DEPENDENT = new Set(['observeHumanActions'])
const OAST_DEPENDENT = new Set(['getOastUrlTool', 'checkOastCallbacks'])

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
      if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const state = await getGlobalObserver().getAuthDetector().detectAuthState(page as any)
      return { ok: true, ...state }
    },
  }), provider)

  extras.testSessionValid = sanitizeTool(createTool({
    id: 'testSessionValid',
    description: 'Check whether the current browser session can reach specified protected URLs.',
    inputSchema: z.object({ urls: z.array(z.string()).min(1) }),
    execute: async ({ urls }) => {
      const page = getActivePage()
      if (!page) return { ok: false, error: 'No active browser page' }
      const results = []
      for (const url of urls) {
        try {
          const response = await (page as any).goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
          results.push({ url, status: response?.status?.() ?? 0, finalUrl: (page as any).url?.() ?? url })
        } catch (error) {
          results.push({ url, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { ok: true, results }
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
      else if (BROWSER_DEPENDENT.has(id)) await options.lazyServices?.ensureBrowser()
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
        requirements: ['browser'],
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

  const discoveryTools = Object.fromEntries(Object.entries(extensionTools).map(([id, tool]) => [id, sanitizeTool(tool, provider)]))
  // Build the adaptive plan BEFORE creating the tool function so it's scope-locked
  const modelRef = resolveModelRef(config, { role: 'brain' })
  const contextWindow = new ContextWindowRegistry(config).getContextWindow(modelRef.modelId)
    || new ContextWindowRegistry(config).getContextWindow(modelRef.model)
    || 128_000

  // ─── Adaptive Brain: compress instructions to fit model ──
  const fullBrainInstructions = getBrainInstructions(config) + loadMethodologySkill(config.target ?? '')
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

  const brainInstructions = compressBrainInstructions(fullBrainInstructions, adaptivePlan)

  const currentTools = () => ({
    ...discoveryTools,
    ...options.extensionRegistry.getActiveToolset(),
  })

  // Adaptive tool filtering: respect the tool budget computed by planAdaptiveContext.
  // Without this, prepareStep returns ALL tools every step, undoing the budget
  // and flooding small-context models with 2000+ tokens of schemas.
  const filteredCurrentTools = () => {
    const all = currentTools()
    const entries = Object.entries(all)
    if (entries.length <= adaptivePlan.toolBudget) return all
    return filterToolsToBudget(entries, adaptivePlan.toolBudget)
  }

  const agent = new Agent({
    name: 'ultimatrix-solver-brain',
    model: resolveModel(config, { role: 'brain' }),
    target: config.target,
    tools: filteredCurrentTools,
    instructions: brainInstructions,
    inputProcessors: [new TokenLimiterProcessor({ limit: Math.floor(contextWindow * 0.7), trimMode: 'contiguous' })],
    defaultOptions: {
      activeTools: Object.keys(filteredCurrentTools()),
      prepareStep: () => ({ tools: filteredCurrentTools(), activeTools: Object.keys(filteredCurrentTools()) }),
      ...(modelRef.maxOutputTokens ? { modelSettings: { maxTokens: modelRef.maxOutputTokens } } : {}),
    },
    ...(options.memory ? { memory: options.memory } : {}),
  } as any)

  agent.id = 'ultimatrix-solver-brain'
  agent.name = 'Ultimatrix Solver Brain'
  ;(agent as any).capabilityRegistry = options.extensionRegistry
  ;(agent as any).lazyServices = options.lazyServices
  ;(agent as any).getTurnToolset = filteredCurrentTools
  return agent
}
