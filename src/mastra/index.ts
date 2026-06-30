import { Agent } from '@mastra/core/agent'
import { createToolRegistry, ToolRegistry } from './tools.js'
import { SkillRegistry } from '../skills/registry.js'
import { WorkerPool } from '../workers/pool.js'
import { StagehandBrowser, createStagehandTools } from '@mastra/stagehand'
import { UltimatrixConfig } from '../config.js'
import { resolveModel } from '../models/factory.js'
import { createSanitizedInputSchema } from '../models/schema-sanitizer.js'
import { Logger } from '../utils/logger.js'
import { resolveToolsForSkills, type Skill } from '../skills/tool-filter.js'
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
  skillIds?: string[]
  skills?: Skill[]
  extraTools?: Record<string, any>
}

export function createAgent(
  config: UltimatrixConfig,
  options?: AgentOptions,
): Agent {
  const log = options?.logger || new Logger('AgentFactory')
  const fullRegistry = options?.tools || createToolRegistry(log)

  let allTools: Record<string, any>

  if (options?.skillIds && options.skillIds.length > 0) {
    const allowedToolIds = new Set(resolveToolsForSkills(options.skillIds))
    allTools = {}
    for (const [key, tool] of Object.entries(fullRegistry)) {
      if (allowedToolIds.has(key)) {
        allTools[key] = tool
      }
    }
    log.info(`Skill-filtered: ${Object.keys(allTools).length} tools from skills [${options.skillIds.join(', ')}]`)
  } else {
    allTools = { ...fullRegistry }
  }

  if (options?.extraTools) {
    Object.assign(allTools, options.extraTools)
  }

  if (options?.browser) {
    Object.assign(allTools, createStagehandTools(options.browser))
  }

  const skillInstructions = options?.skills
    ? options.skills.map(s => s.instructions).join('\n\n')
    : ''

  const agentConfig: any = {
    name: 'ultimatrix-agent',
    model: resolveModel(config, options?.tier),
    target: config.target,
    tools: sanitizeToolRecord(allTools, config.provider),
    instructions: getAgentInstructions(config, skillInstructions),
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
- If you need the human to log in, solve a CAPTCHA, or perform a manual action:
  call askUser({ waitForBrowserAction: true, question: "..." })
- The human acts in the browser window, you capture what they did
- After they act: observeHumanActions() → saveSession() → continue testing
- If you're stuck on authentication: ask the human to demonstrate, then reproduce

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
  }

  if (browser) {
    Object.assign(reconTools, createStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'recon-worker',
    name: 'Recon Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(reconTools, config.provider),
    instructions: `
You are a reconnaissance specialist focused on mapping the attack surface of web applications.

Your mission:
1. Discover all accessible endpoints and functionality
2. Identify technologies and frameworks in use
3. Map authentication flows and session management
4. Find potential entry points for further testing
5. Document findings for other agents to use

Focus on:
- Endpoint discovery and mapping
- Technology fingerprinting
- Authentication flow analysis
- Metadata and configuration exposure
- API introspection

Be thorough and systematic in your approach.
`,
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
  }

  if (browser) {
    Object.assign(injectionTools, createStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'injection-worker',
    name: 'Injection Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(injectionTools, config.provider),
    instructions: `
You are an injection testing specialist focused on finding and exploiting injection vulnerabilities.

Your mission:
1. Test for SQL injection, XSS, command injection, and other injection types
2. Bypass security controls and filters
3. Document injection points and their impact
4. Generate proof-of-concept payloads
5. Chain injection findings with other vulnerabilities

Focus on:
- Parameter testing and manipulation
- Filter bypass techniques
- Error-based and blind injection
- Stored vs reflected XSS
- Command injection and RCE
- XML and template injection

Be methodical and document all findings thoroughly.
`,
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
  }

  if (browser) {
    Object.assign(authTools, createStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'auth-control-worker',
    name: 'Auth Control Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(authTools, config.provider),
    instructions: `
You are an authentication testing specialist focused on finding and exploiting authentication vulnerabilities.

Your mission:
1. Test authentication flows for weaknesses
2. Identify session management issues
3. Test for privilege escalation and broken access control
4. Document authentication bypass techniques
5. Analyze RBAC and permission systems

Focus on:
- Login form testing
- Session fixation and hijacking
- Access control testing
- Privilege escalation
- Token manipulation
- OAuth and SAML testing

Be systematic and respect authentication boundaries.
`,
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
  }

  if (browser) {
    Object.assign(advancedTools, createStagehandTools(browser))
  }

  const agentConfig: any = {
    id: 'advanced-worker',
    name: 'Advanced Worker',
    model: resolveModel(config),
    tools: sanitizeToolRecord(advancedTools, config.provider),
    instructions: `
You are an advanced security testing specialist focused on complex vulnerabilities and attack chains.

Your mission:
1. Test for advanced vulnerabilities like SSRF, XXE, deserialization
2. Identify complex attack chains and multi-step exploits
3. Analyze business logic flaws and design issues
4. Test for race conditions and time-based vulnerabilities
5. Document comprehensive attack scenarios

Focus on:
- Server-side request forgery
- XML external entity attacks
- Deserialization vulnerabilities
- Business logic flaws
- Race conditions and timing attacks
- Complex multi-step exploits

Be thorough and creative in your approach.
`,
  }

  if (memory) agentConfig.memory = memory

  if (browser) {
    agentConfig.context = { browser }
  }

  log.info('Creating advanced agent')
  return new Agent(agentConfig)
}
