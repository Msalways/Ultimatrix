import { Agent } from '@mastra/core/agent'
import { createToolRegistry, ToolRegistry } from './tools.js'
import { SkillRegistry } from '../skills/registry.js'
import { WorkerPool } from '../workers/pool.js'
import { StagehandBrowser, createStagehandTools } from '@mastra/stagehand'
import { UltimatrixConfig } from '../config.js'
import { resolveModel } from '../models/factory.js'
import { createSanitizedInputSchema } from '../models/schema-sanitizer.js'
import { Logger } from '../utils/logger.js'
import type { MastraMemory } from '@mastra/core/memory'
import type { StandardSchemaV1 } from '@mastra/schema-compat/schema'

function sanitizeToolArray(tools: any[], provider?: string): any[] {
  if (!provider) return tools
  return tools.map(tool => {
    if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in tool.inputSchema) {
      return {
        ...tool,
        inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, provider),
      }
    }
    return tool
  })
}

// Centralized agent creation factory
export function createAgent(
  config: UltimatrixConfig,
  options?: {
    skillRegistry?: SkillRegistry
    workerPool?: WorkerPool
    browser?: StagehandBrowser
    tools?: ToolRegistry
    logger?: Logger
    memory?: MastraMemory
    tier?: 'fast' | 'balanced' | 'powerful' | 'default'
  },
): Agent {
  const log = options?.logger || new Logger('AgentFactory')
  const toolRegistry = options?.tools || createToolRegistry(log)

  const allTools = Object.values(toolRegistry)
  if (options?.browser) {
    const stagehandTools = Object.values(createStagehandTools(options.browser))
    allTools.push(...stagehandTools)
  }

  const agentConfig: any = {
    name: 'ultimatrix-agent',
    model: resolveModel(config, options?.tier),
    target: config.target,
    tools: sanitizeToolArray(allTools, config.provider),
    instructions: getAgentInstructions(config),
  }

  if (options?.memory) {
    agentConfig.memory = options.memory
  }

  if (options?.browser) {
    agentConfig.context = {
      browser: options.browser,
    }
  }

  log.info(`Creating agent with ${allTools.length} tools${options?.browser ? ' (incl. Stagehand)' : ''}`)

  return new Agent(agentConfig)
}

// Get agent instructions based on config
function getAgentInstructions(config: UltimatrixConfig): string {
  const baseInstructions = `
You are Ultimatrix, an autonomous security researcher that discovers vulnerabilities through systematic testing.

Core Principles:
1. Be thorough and methodical in your approach
2. Focus on practical, exploitable vulnerabilities
3. Document findings with clear evidence
4. Respect the target and avoid unnecessary damage
5. Collaborate with other agents when needed

Key Responsibilities:
- Discover vulnerabilities through systematic testing
- Document findings with clear evidence
- Chain vulnerabilities together to understand attack paths
- Generate test cases for discovered vulnerabilities
- Maintain accurate state of the application

Communication Style:
- Use clear, concise language
- Provide specific details about findings
- Explain your reasoning for each action
- Be transparent about limitations and uncertainties

Safety Guidelines:
- Only test for publicly accessible endpoints
- Respect rate limits and server capacity
- Avoid destructive actions unless explicitly instructed
- Report any issues that could impact availability
`

  if (config.target) {
    return `${baseInstructions}

Current Target: ${config.target}

Focus on this target and provide detailed analysis of potential vulnerabilities.
`
  }

  return baseInstructions
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

  const reconTools = [
    toolRegistry.runRecon,
    toolRegistry.graphqlIntrospect,
    toolRegistry.jwtDecode,
    toolRegistry.frameworkFingerprint,
    toolRegistry.cloudMetadataProbe,
    toolRegistry.httpRequest,
    toolRegistry.findEndpointsInResponse,
  ]

  if (browser) {
    reconTools.push(...Object.values(createStagehandTools(browser)))
  }

  const agentConfig: any = {
    id: 'recon-worker',
    name: 'Recon Worker',
    model: resolveModel(config),
    tools: sanitizeToolArray(reconTools, config.provider),
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

  const injectionTools = [
    toolRegistry.httpRequest,
    toolRegistry.multipartUpload,
    toolRegistry.followRedirects,
    toolRegistry.parseResponse,
    toolRegistry.evaluateRendered,
    toolRegistry.checkWaf,
    toolRegistry.recordEvidence,
    toolRegistry.writeFinding,
    toolRegistry.queryGraph,
    toolRegistry.updateGraph,
  ]

  if (browser) {
    injectionTools.push(...Object.values(createStagehandTools(browser)))
  }

  const agentConfig: any = {
    id: 'injection-worker',
    name: 'Injection Worker',
    model: resolveModel(config),
    tools: sanitizeToolArray(injectionTools, config.provider),
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

  const authTools = [
    toolRegistry.extractSessionCookie,
    toolRegistry.extractCsrfToken,
    toolRegistry.useSession,
    toolRegistry.httpRequest,
    toolRegistry.parseResponse,
    toolRegistry.recordEvidence,
    toolRegistry.writeFinding,
    toolRegistry.queryGraph,
    toolRegistry.updateGraph,
    toolRegistry.getAuthFlows,
  ]

  if (browser) {
    authTools.push(...Object.values(createStagehandTools(browser)))
  }

  const agentConfig: any = {
    id: 'auth-control-worker',
    name: 'Auth Control Worker',
    model: resolveModel(config),
    tools: sanitizeToolArray(authTools, config.provider),
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

  const advancedTools = [
    toolRegistry.httpRequest,
    toolRegistry.multipartUpload,
    toolRegistry.followRedirects,
    toolRegistry.parseResponse,
    toolRegistry.evaluateRendered,
    toolRegistry.measureTiming,
    toolRegistry.compareResponses,
    toolRegistry.checkWaf,
    toolRegistry.recordEvidence,
    toolRegistry.writeFinding,
    toolRegistry.queryGraph,
    toolRegistry.updateGraph,
    toolRegistry.getAttackPath,
    toolRegistry.getUntestedActions,
    toolRegistry.frameworkFingerprint,
    toolRegistry.cloudMetadataProbe,
  ]

  if (browser) {
    advancedTools.push(...Object.values(createStagehandTools(browser)))
  }

  const agentConfig: any = {
    id: 'advanced-worker',
    name: 'Advanced Worker',
    model: resolveModel(config),
    tools: sanitizeToolArray(advancedTools, config.provider),
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
