import { Agent } from '@mastra/core/agent'
import { createToolRegistry, ToolRegistry } from './tools'
import { SkillRegistry } from '../solver/skills/registry'
import { WorkerPool } from '../workers/pool'
import { StagehandBrowser } from '@mastra/stagehand'
import { wrapStagehandTools } from '../browser/dialog-inject'
import { UltimatrixConfig } from '../config'
import { resolveModel } from '../models/factory'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import { Logger } from '../utils/logger'
import { resolveToolsForSkills } from '../solver/skills/tool-filter'
import type { Skill } from '../solver/skills/registry'
import type { MastraMemory } from '@mastra/core/memory'
import type { StandardSchemaWithJSON } from '@mastra/schema-compat/schema'

function sanitizeToolRecord(tools: Record<string, any>, provider?: string): Record<string, any> {
  if (!provider) return tools
  const sanitized: Record<string, any> = {}
  for (const [key, tool] of Object.entries(tools)) {
    if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in tool.inputSchema) {
      sanitized[key] = {
        ...tool,
        inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaWithJSON, provider),
      }
    } else {
      sanitized[key] = tool
    }
  }
  return sanitized
}

export interface AgentOptions {
  skillRegistry?: SkillRegistry
  workerPool?: WorkerPool
  browser?: StagehandBrowser
  tools?: ToolRegistry
  logger?: Logger
  memory?: MastraMemory
  tier?: 'fast' | 'balanced' | 'powerful' | 'default'
  modelId?: string
  skillIds?: string[]
  skills?: Skill[]
  extraTools?: Record<string, any>
  /** Explicit allow-list of tool IDs. When set, only these tools are exposed. */
  toolIds?: string[]
  /** Additional instructions appended after the base + skill instructions (e.g. current task). */
  taskInstructions?: string
}

/**
 * Intersect two allow-sets. `undefined` on either side means "no restriction",
 * so the other side wins. Both undefined → no restriction.
 */
function intersectAllowSets(a?: Set<string>, b?: Set<string>): Set<string> | undefined {
  if (!a) return b
  if (!b) return a
  const out = new Set<string>()
  for (const id of a) if (b.has(id)) out.add(id)
  return out
}

export function createAgent(
  config: UltimatrixConfig,
  options?: AgentOptions,
): Agent {
  const log = options?.logger || new Logger('AgentFactory')
  const fullRegistry = options?.tools || createToolRegistry(log)

  // Build the skill-derived allow-set (existing behavior).
  let allowSet: Set<string> | undefined
  if (options?.skillIds && options.skillIds.length > 0) {
    allowSet = new Set(resolveToolsForSkills(options.skillIds))
  }

  // Build the explicit toolIds allow-set (council per-role restrictions).
  let explicitSet: Set<string> | undefined
  if (options?.toolIds && options.toolIds.length > 0) {
    explicitSet = new Set(options.toolIds)
  }

  // Single source of truth: intersection of all active restrictions.
  const effectiveAllow = intersectAllowSets(allowSet, explicitSet)

  let allTools: Record<string, any>
  if (effectiveAllow) {
    allTools = {}
    for (const [key, tool] of Object.entries(fullRegistry)) {
      if (effectiveAllow.has(key)) {
        allTools[key] = tool
      }
    }
    // Surface allow-set IDs that don't match any registered tool (typo in a
    // skill's toolRefs or CORE_TOOLS). These are silently dropped above, so
    // warn loudly to prevent silent capability gaps.
    const unknown = [...effectiveAllow].filter(id => !(id in fullRegistry))
    if (unknown.length > 0) {
      log.warn(`Tool-filtered allow-set references ${unknown.length} unknown tool ID(s), silently dropped: ${unknown.join(', ')}`)
    }
    const source = options?.toolIds?.length
      ? `toolIds [${options.toolIds.join(', ')}]`
      : `skills [${options!.skillIds!.join(', ')}]`
    log.info(`Tool-filtered (${source}): ${Object.keys(allTools).length}/${Object.keys(fullRegistry).length} tools`)
  } else {
    allTools = { ...fullRegistry }
  }

  if (options?.extraTools) {
    Object.assign(allTools, options.extraTools)
  }

  if (options?.browser) {
    Object.assign(allTools, wrapStagehandTools(options.browser))
  }

  const skillInstructions = options?.skills
    ? options.skills.map(s => s.instructions).join('\n\n')
    : ''

  const fullInstructions = [
    getAgentInstructions(config, skillInstructions),
    options?.taskInstructions ? `\n## Current Task\n${options.taskInstructions}` : '',
  ].filter(Boolean).join('\n')

  const agentConfig: any = {
    name: 'ultimatrix-agent',
    model: resolveModel(config, options?.modelId ? { modelId: options.modelId, tier: options?.tier } : options?.tier),
    target: config.target,
    tools: sanitizeToolRecord(allTools, config.provider),
    instructions: fullInstructions,
  }

  if (options?.memory) {
    agentConfig.memory = options.memory
  }

  if (options?.browser) {
    agentConfig.context = {
      browser: options.browser,
    }
  }

  log.info(`Creating agent with ${Object.keys(allTools).length} tools${options?.browser ? ' (incl. Stagehand)' : ''}`)

  return new Agent(agentConfig)
}

function getAgentInstructions(config: UltimatrixConfig, skillInstructions: string = ''): string {
  const baseInstructions = `
You are Ultimatrix, an autonomous security researcher. You test web applications for vulnerabilities by directly executing attacks using your tools. You are NOT a router — you are the attacker.

Core Principles:
1. Test endpoints directly using your tools — do not just plan, ACT
2. Use the skill methodology loaded below to guide your approach
3. Record every observation in the graph with updateGraph
4. Write findings with evidence using writeFinding
5. If you need parallel testing, delegate with spawn-worker or spawn-swarm
6. Learn from failures — if an approach fails, try the next one from the skill

Attack Protocol:
1. Read the loaded skill methodology below — it tells you HOW to test
2. Use your available tools to execute the attack steps
3. Record what you find (endpoints, responses, errors, patterns)
4. When you confirm a vulnerability, write a finding with evidence
5. If you hit a dead end, try a different approach from the skill
6. If you need to test many endpoints in parallel, spawn workers

Human-in-the-Loop (Mutual Attack):
- If the client says they will handle something (log in, solve CAPTCHA, do an action), navigate to the target and let them — do NOT call askUser
- askUser is the LAST RESORT, not the first option — only when YOU are stuck and cannot proceed
- When you DO need askUser: call askUser({ waitForBrowserAction: true, question: "..." })
- The human acts in the browser window, you capture what they did
- After they act: observeHumanActions() → saveSession() → continue testing

Safety:
- Only test the authorized target
- Respect rate limits
- Do not cause denial of service
`

  const targetBlock = config.target
    ? `\n\nCurrent Target: ${config.target}`
    : ''

  const skillBlock = skillInstructions
    ? `\n\n## Loaded Skill Methodology\n\n${skillInstructions}`
    : '\n\nNo skill loaded. Use searchSkills to find relevant methodology, or proceed with general web security testing knowledge.'

  return baseInstructions + targetBlock + skillBlock
}

// Agent creation utilities for different worker types
export function createReconAgent(
  config: UltimatrixConfig,
  browser?: StagehandBrowser,
  logger?: Logger,
  memory?: MastraMemory,
): Agent {
  const log = logger || new Logger('ReconAgentFactory')
  const toolRegistry = createToolRegistry(log)

  const reconTools: Record<string, any> = {
    runRecon: toolRegistry.runRecon,
    graphqlIntrospect: toolRegistry.graphqlIntrospect,
    jwtDecode: toolRegistry.jwtDecode,
    frameworkFingerprint: toolRegistry.frameworkFingerprint,
    cloudMetadataProbe: toolRegistry.cloudMetadataProbe,
    httpRequest: toolRegistry.httpRequest,
    findEndpointsInResponse: toolRegistry.findEndpointsInResponse,
    getCapturedHeaders: toolRegistry.getCapturedHeaders,
    storeSession: toolRegistry.storeSession,
    evaluateRendered: toolRegistry.evaluateRendered,
    recordEvidence: toolRegistry.recordEvidence,
    recordTestCase: toolRegistry.recordTestCase,
    updateGraph: toolRegistry.updateGraph,
    queryGraph: toolRegistry.queryGraph,
    upsertPage: toolRegistry.upsertPage,
    addAction: toolRegistry.addAction,
    addEndpoint: toolRegistry.addEndpoint,
    askUser: toolRegistry.askUser,
    detectReactions: toolRegistry.detectReactions,
    getDialogEvidence: toolRegistry.getDialogEvidence,
    getRecentChanges: toolRegistry.getRecentChanges,
    saveSession: toolRegistry.saveSession,
    restoreSession: toolRegistry.restoreSession,
    observeHumanActions: toolRegistry.observeHumanActions,
  }

  if (browser) {
    Object.assign(reconTools, wrapStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'recon-worker',
    name: 'Recon Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(reconTools, config.provider),
  }

  if (memory) agentConfig.memory = memory

  if (browser) {
    agentConfig.context = { browser }
  }

  log.info('Creating recon agent')
  return new Agent(agentConfig)
}

export function createInjectionAgent(
  config: UltimatrixConfig,
  browser?: StagehandBrowser,
  logger?: Logger,
  memory?: MastraMemory,
): Agent {
  const log = logger || new Logger('InjectionAgentFactory')
  const toolRegistry = createToolRegistry(log)

  const injectionTools: Record<string, any> = {
    httpRequest: toolRegistry.httpRequest,
    multipartUpload: toolRegistry.multipartUpload,
    followRedirects: toolRegistry.followRedirects,
    parseResponse: toolRegistry.parseResponse,
    evaluateRendered: toolRegistry.evaluateRendered,
    checkWaf: toolRegistry.checkWaf,
    recordEvidence: toolRegistry.recordEvidence,
    writeFinding: toolRegistry.writeFinding,
    queryGraph: toolRegistry.queryGraph,
    updateGraph: toolRegistry.updateGraph,
    getCapturedHeaders: toolRegistry.getCapturedHeaders,
    storeSession: toolRegistry.storeSession,
    findEndpointsInResponse: toolRegistry.findEndpointsInResponse,
    measureTiming: toolRegistry.measureTiming,
    compareResponses: toolRegistry.compareResponses,
    omitHeader: toolRegistry.omitHeader,
    getOastUrlTool: toolRegistry.getOastUrlTool,
    checkOastCallbacks: toolRegistry.checkOastCallbacks,
    recordTestCase: toolRegistry.recordTestCase,
    detectReactions: toolRegistry.detectReactions,
    getDialogEvidence: toolRegistry.getDialogEvidence,
    getRecentChanges: toolRegistry.getRecentChanges,
  }

  if (browser) {
    Object.assign(injectionTools, wrapStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'injection-worker',
    name: 'Injection Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(injectionTools, config.provider),
  }

  if (memory) agentConfig.memory = memory

  if (browser) {
    agentConfig.context = { browser }
  }

  log.info('Creating injection agent')
  return new Agent(agentConfig)
}

export function createAuthControlAgent(
  config: UltimatrixConfig,
  browser?: StagehandBrowser,
  logger?: Logger,
  memory?: MastraMemory,
): Agent {
  const log = logger || new Logger('AuthControlAgentFactory')
  const toolRegistry = createToolRegistry(log)

  const authTools: Record<string, any> = {
    extractSessionCookie: toolRegistry.extractSessionCookie,
    extractCsrfToken: toolRegistry.extractCsrfToken,
    useSession: toolRegistry.useSession,
    httpRequest: toolRegistry.httpRequest,
    parseResponse: toolRegistry.parseResponse,
    recordEvidence: toolRegistry.recordEvidence,
    writeFinding: toolRegistry.writeFinding,
    queryGraph: toolRegistry.queryGraph,
    updateGraph: toolRegistry.updateGraph,
    getAuthFlows: toolRegistry.getAuthFlows,
    getCapturedHeaders: toolRegistry.getCapturedHeaders,
    storeSession: toolRegistry.storeSession,
    findEndpointsInResponse: toolRegistry.findEndpointsInResponse,
    evaluateRendered: toolRegistry.evaluateRendered,
    omitHeader: toolRegistry.omitHeader,
    recordTestCase: toolRegistry.recordTestCase,
    askUser: toolRegistry.askUser,
    detectReactions: toolRegistry.detectReactions,
    getDialogEvidence: toolRegistry.getDialogEvidence,
    getRecentChanges: toolRegistry.getRecentChanges,
  }

  if (browser) {
    Object.assign(authTools, wrapStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'auth-control-worker',
    name: 'Auth Control Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(authTools, config.provider),
  }

  if (memory) agentConfig.memory = memory

  if (browser) {
    agentConfig.context = { browser }
  }

  log.info('Creating auth control agent')
  return new Agent(agentConfig)
}

export function createAdvancedAgent(
  config: UltimatrixConfig,
  browser?: StagehandBrowser,
  logger?: Logger,
  memory?: MastraMemory,
): Agent {
  const log = logger || new Logger('AdvancedAgentFactory')
  const toolRegistry = createToolRegistry(log)

  const advancedTools: Record<string, any> = {
    httpRequest: toolRegistry.httpRequest,
    multipartUpload: toolRegistry.multipartUpload,
    followRedirects: toolRegistry.followRedirects,
    parseResponse: toolRegistry.parseResponse,
    evaluateRendered: toolRegistry.evaluateRendered,
    measureTiming: toolRegistry.measureTiming,
    compareResponses: toolRegistry.compareResponses,
    checkWaf: toolRegistry.checkWaf,
    recordEvidence: toolRegistry.recordEvidence,
    writeFinding: toolRegistry.writeFinding,
    queryGraph: toolRegistry.queryGraph,
    updateGraph: toolRegistry.updateGraph,
    getAttackPath: toolRegistry.getAttackPath,
    getUntestedActions: toolRegistry.getUntestedActions,
    frameworkFingerprint: toolRegistry.frameworkFingerprint,
    cloudMetadataProbe: toolRegistry.cloudMetadataProbe,
    getCapturedHeaders: toolRegistry.getCapturedHeaders,
    storeSession: toolRegistry.storeSession,
    findEndpointsInResponse: toolRegistry.findEndpointsInResponse,
    omitHeader: toolRegistry.omitHeader,
    recordTestCase: toolRegistry.recordTestCase,
    detectReactions: toolRegistry.detectReactions,
    getDialogEvidence: toolRegistry.getDialogEvidence,
    getRecentChanges: toolRegistry.getRecentChanges,
  }

  if (browser) {
    Object.assign(advancedTools, wrapStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'advanced-worker',
    name: 'Advanced Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(advancedTools, config.provider),
  }

  if (memory) agentConfig.memory = memory

  if (browser) {
    agentConfig.context = { browser }
  }

  log.info('Creating advanced agent')
  return new Agent(agentConfig)
}
