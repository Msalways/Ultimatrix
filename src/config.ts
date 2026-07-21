import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { load, dump } from 'js-yaml'

// ─── Credential types ───────────────────────────────────────────────

export interface ApiKeyCreds {
  apiKey: string
  baseUrl?: string
}

export interface AzureCreds {
  apiKey: string
  endpoint: string
  deployment: string
  apiVersion: string
}

export interface BedrockCreds {
  authMethod: 'iam' | 'api_key'
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  apiKey?: string
}

export interface CustomCreds {
  apiKey: string
  baseUrl: string
}

export type ProviderCredentials = {
  openai?: ApiKeyCreds
  anthropic?: ApiKeyCreds
  google?: ApiKeyCreds
  nvidia?: ApiKeyCreds
  groq?: ApiKeyCreds
  together?: ApiKeyCreds
  deepseek?: ApiKeyCreds
  mistral?: ApiKeyCreds
  xai?: ApiKeyCreds
  perplexity?: ApiKeyCreds
  cerebras?: ApiKeyCreds
  deepinfra?: ApiKeyCreds
  openrouter?: ApiKeyCreds
  bedrock?: BedrockCreds
  azure?: AzureCreds
  custom?: CustomCreds
  [key: string]: ApiKeyCreds | AzureCreds | BedrockCreds | CustomCreds | undefined
}

// ─── Config interface ───────────────────────────────────────────────

export interface BrowserConfig {
  headless: boolean
  viewport: { width: number; height: number }
  domSettleTimeout: number
  env: string
  selfHeal: boolean
  verbose: number
}

export interface MemoryConfig {
  lastMessages: number
  semanticRecall: boolean
  workingMemory: boolean
}

export interface AgentConfig {
  maxSteps: number
  scansDir: string
}

export interface RateLimitConfig {
  requestsPerMinute: number
  tokensPerMinute?: number
  maxConcurrent: number
  retryOnLimit: boolean
  maxRetries: number
  backoffStrategy?: 'exponential' | 'stepped' | 'fixed'
  backoffSteps?: number[]
  baseBackoffMs?: number
  maxBackoffMs?: number
  useHeaders?: boolean
  headerMapping?: {
    remaining?: string
    reset?: string
    retryAfter?: string
    tokensRemaining?: string
    tokensReset?: string
  }
}

export interface TierConfig {
  provider: string
  model: string
}

export interface ModelTiers {
  fast?: TierConfig
  balanced?: TierConfig
  powerful?: TierConfig
}

export interface AuthorizationConfig {
  confirmed: boolean
  method: 'bounty' | 'pentest-contract' | 'written-permission' | 'self-owned' | 'lab'
  target: string
  timestamp: string
}

export interface SolverConfig {
  maxToolCalls?: number
  /** @deprecated maxTokens is not enforced. Use maxToolCalls to control turn budget. */
  maxTokens?: number
  maxDurationMs?: number
  maxParallel?: number
  maxRounds?: number
  /** Max escalation primitives the active chain planner may execute per turn (0 = disabled). */
  maxActiveChainSteps?: number
}

/**
 * Interaction display policy — product-level choices about what the solver
 * surfaces to the operator. These are preferences, not provider behavior: the
 * engine still reasons/tests identically regardless of these flags.
 */
export interface InteractionConfig {
  /**
   * Show the model's reasoning/thinking. Reasoning is the buddy's decision
   * context (SDK `reasoningText`), normalized across providers. Default: true.
   */
  showReasoning?: boolean
  /**
   * Show the dim "system events" block (tooling/quota/summary lines) below the
   * answer card. Default: true.
   */
  showSystemEvents?: boolean
  /**
   * Use the unified chat-box renderer for `ultimatrix interact` — one session-wide
   * terminal owner that frames each user message + reply as a chat card, routes the
   * spider crawl as live activity, and captures log.* as a single system-events block.
   * When false, falls back to the legacy autonomous-run card (ChatStream). Default: true.
   */
  chat?: boolean
}

export interface SpiderConfig {
  enabled?: boolean
  maxSteps?: number
  maxDurationMs?: number
}

export interface AntiLoopConfig {
  staleThreshold?: number
  maxFailedTarget?: number
}

export interface ReflexionConfig {
  enabled?: boolean
  maxSameVulnFails?: number
  maxTotalNoProgress?: number
  escalationMaxLevel?: number
}

export interface VerifierConfig {
  enabled?: boolean
  /** Max pending findings to re-verify per round */
  maxPerRound?: number
  /** Timeout in ms for a single verification attempt */
  timeoutMs?: number
}

export interface ScopeConfig {
  /** Domains allowed for outbound requests. Supports exact match and wildcard (*.example.com).
   *  Optional — when omitted (or empty) the tool is free-for-all (no domain restriction). */
  allowedDomains?: string[]
  /** URL path prefixes allowed (e.g., ['/api', '/admin']). Empty = all paths. */
  allowedPaths?: string[]
  /** Protocols allowed. Default: ['https']. */
  allowedProtocols?: string[]
  /** Enforcement mode: 'hard' blocks out-of-scope requests, 'warn' logs but allows. */
  enforcement: 'hard' | 'warn'
}

export interface CampaignConfig {
  /** Auto plan + run a coverage campaign at the start of a solver goal. */
  auto?: boolean
  /** Cap on number of slices to execute (highest priority first). */
  maxSlices?: number
  /** Bounded concurrency for slice execution. */
  maxConcurrency?: number
}

export interface OastConfig {
  /** External callback host (e.g. 'oast.pro', 'interact.sh'). Overrides local server. */
  externalHost?: string
  /** Callback TTL in ms. Expired callbacks are pruned on read. Default: 3600000 (1h). */
  callbackTtlMs?: number
}

/**
 * @deprecated 'solver' is an alias for 'multi-model'.
 * 'council' is deprecated — council is now a REPL command (`/council <goal>`),
 * not an engine. Use 'multi-model' and invoke council via `/council`.
 */
export type EngineType = 'legacy' | 'solver' | 'multi-model' | 'council'

// Rigid engine coercion map. Council and solver are deprecated aliases that
// both collapse to the multi-model engine (council is now a REPL command).
// This is a deterministic config→config map — no LLM-meaning detection.
export const ENGINE_COERCION: Record<EngineType, EngineType> = {
  legacy: 'legacy',
  solver: 'multi-model',
  'multi-model': 'multi-model',
  council: 'multi-model',
}

// ─── Model capability metadata ────────────────────────────────────

export interface ModelCapability {
  contextWindow: number
  maxOutputTokens: number
  maxTokensPerMinute?: number
  strengths: string[]
  supportsStreaming: boolean
  supportsStructuredOutput: boolean
  supportsVision?: boolean
}

export type ModelCapabilities = Record<string, ModelCapability>

// ─── Compression configuration ─────────────────────────────────────

export interface CompressionConfig {
  headroom?: {
    enabled?: boolean
    tokenBudget?: number
    fallbackToTruncation?: boolean
    maxResponseSize?: number
    model?: string
  }
}

export interface TruncationConfig {
  maxResponseSize?: number
  fallbackEnabled?: boolean
}

// ─── Budget policy ────────────────────────────────────────────────

export interface BudgetPolicy {
  enforcement: 'hard' | 'soft' | 'warn'
  scope: 'turn' | 'session'
  resetOn: 'turn' | 'never'
  allocation: {
    brain: number
    workers: number
    spider: number
  }
  maxModelCallsPerTask: number
  maxTokensPerSession?: number
  trackTokens: boolean
}

export interface ToolTokenProfile {
  toolId: string
  avgModelCalls: number
  avgInputTokens: number
  avgOutputTokens: number
  externalApiCalls?: Array<{ service: string; avgCallsPerExecution: number }>
  lastUpdated: string
  sampleCount: number
  estimated?: boolean
}

export type ProviderRateLimits = Record<string, RateLimitConfig>

// ─── Single source of truth for defaults ───────────────────────────

export const DEFAULTS = {
  solver: {
    maxToolCalls: 50,
    maxDurationMs: 300_000,
    maxParallel: 1,
    maxRounds: 5,
    maxActiveChainSteps: 3,
  },
  antiLoop: {
    staleThreshold: 3,
    maxFailedTarget: 3,
  },
  agent: {
    maxSteps: 25,
    scansDir: './scans',
  },
  rateLimit: {
    requestsPerMinute: 15,
    maxConcurrent: 2,
    retryOnLimit: true,
    maxRetries: 3,
    backoffStrategy: 'stepped',
    backoffSteps: [5000, 15000, 30000],
    baseBackoffMs: 2000,
    maxBackoffMs: 30000,
    useHeaders: true,
  },
  memory: {
    lastMessages: 10,
    semanticRecall: false,
    workingMemory: true,
  },
  browser: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    domSettleTimeout: 5000,
    env: 'LOCAL',
    selfHeal: true,
    verbose: 0,
  },
  engine: 'multi-model' as EngineType,
  depth: 2,
  timeout: 60_000,
  verifier: {
    enabled: true,
    maxPerRound: 5,
    timeoutMs: 30_000,
  },
  budgetPolicy: {
    enforcement: 'soft',
    scope: 'session',
    resetOn: 'never',
    allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
    maxModelCallsPerTask: 15,
    trackTokens: false,
  },
  compression: {
    headroom: {
      enabled: true,
      tokenBudget: 100000,
      fallbackToTruncation: true,
      maxResponseSize: 200000,
      model: 'gpt-4o',
    },
  },
  truncation: {
    maxResponseSize: 50000,
    fallbackEnabled: true,
  },
} as const

export interface UltimatrixConfig {
  provider: string
  model: string
  target?: string
  depth: number
  timeout: number
  creds: ProviderCredentials
  modelTiers?: ModelTiers
  browser: BrowserConfig
  memory: MemoryConfig
  agent: AgentConfig
  rateLimit: RateLimitConfig
  authorization?: AuthorizationConfig
  scope?: ScopeConfig
  engine?: EngineType
  solver?: SolverConfig
  spider?: SpiderConfig
  antiLoop?: AntiLoopConfig
  reflexion?: ReflexionConfig
  verifier?: VerifierConfig
  modelCapabilities?: ModelCapabilities
  /** Refuse (not just warn) when a sub-16K-context model is used for complex goals. */
  requireCapableModel?: boolean
  /** Council engine configuration (strategist/operator/skeptic/analyst/human). */
  council?: import('./council/types').CouncilConfig
  budgetPolicy?: BudgetPolicy
  /** Phase 2 campaign dispatch (T2.6) — coverage automation for the solver. */
  campaign?: CampaignConfig
  providerRateLimits?: ProviderRateLimits
  providerKeys?: Record<string, ApiKeyCreds>
  compression?: CompressionConfig
  truncation?: TruncationConfig
  oast?: OastConfig
  /** Phase 1/5: MCP server registrations (stdio/http/sse). */
  mcp?: McpServerConfig[]
  /** Phase 1/5: code plugin registrations. */
  plugins?: PluginConfig[]
  /** Phase 7.1: additional skill directories beyond the bundled src/skills. */
  skillsDirs?: string[]
  /** Phase 7.2: skill selection options. */
  skills?: { exclude?: string[] }
  /** Interaction display policy (reasoning visibility, system-event log). */
  interaction?: InteractionConfig
}

// ─── Extensibility config types (Phase 1 / 5) ─────────────────────────

export interface McpServerConfig {
  name: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  type?: 'stdio' | 'http' | 'sse'
  auth?: {
    kind: 'oauth' | 'client-credentials'
    clientId?: string
    clientSecret?: string
    scope?: string
    redirectPort?: number
  }
}

export interface PluginConfig {
  id: string
  path: string
  env?: Record<string, string>
}

// ─── Dynamic memory sizing based on model context window ─────────────

export const CONTEXT_WINDOW_MAP: Record<string, number> = {
  'groq/llama3-8b-8192': 8192,
  'groq/llama3-70b-8192': 8192,
  'groq/llama3.1-8b-instant': 131072,
  'groq/llama-3.1-8b-instant': 131072,
  'groq/llama-3.3-70b-versatile': 131072,
  'groq/gemma2-9b-it': 8192,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000,
  'openai/gpt-4-turbo': 128000,
  'anthropic/claude-3-5-sonnet': 200000,
  'anthropic/claude-3-opus': 200000,
  'google/gemini-2.0-flash': 1048576,
  'google/gemini-2.5-pro': 1048576,
  'nvidia/nvidia/nemotron-3-ultra-550b-a55b': 131072,
  'nvidia/nemotron-3-ultra-550b-a55b': 131072,
}

export function computeLastMessages(model: string, defaultLastMessages: number): number {
  const ctx = CONTEXT_WINDOW_MAP[model]
  if (!ctx) return defaultLastMessages
  if (ctx <= 8192) return 4
  if (ctx <= 32000) return 10
  if (ctx <= 131072) return 20
  return Math.min(30, defaultLastMessages)
}

// ─── Single source of truth for providers ────────────────────────────

export interface ProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  envVar: string
}

export const PROVIDER_INFO: Record<string, ProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    envVar: 'ANTHROPIC_API_KEY',
  },
  google: {
    id: 'google',
    name: 'Google (Gemini)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    envVar: 'NVIDIA_API_KEY',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    envVar: 'TOGETHER_API_KEY',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    envVar: 'MISTRAL_API_KEY',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    defaultBaseUrl: 'https://api.x.ai/v1',
    envVar: 'XAI_API_KEY',
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    defaultBaseUrl: 'https://api.perplexity.ai',
    envVar: 'PERPLEXITY_API_KEY',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    envVar: 'CEREBRAS_API_KEY',
  },
  deepinfra: {
    id: 'deepinfra',
    name: 'DeepInfra',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    envVar: 'DEEPINFRA_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
  },
  azure: {
    id: 'azure',
    name: 'Azure OpenAI',
    defaultBaseUrl: '',
    envVar: 'AZURE_API_KEY',
  },
  bedrock: {
    id: 'bedrock',
    name: 'AWS Bedrock',
    defaultBaseUrl: '',
    envVar: 'AWS_ACCESS_KEY_ID',
  },
}

/**
 * Resolve a provider alias to its base provider name.
 * e.g., "groq-free" → "groq", "openai-preview" → "openai"
 * If the name is already a known provider, returns it as-is.
 */
export function resolveProviderAlias(provider: string): string {
  if (PROVIDER_INFO[provider]) return provider
  const dashIdx = provider.indexOf('-')
  if (dashIdx > 0) {
    const base = provider.slice(0, dashIdx)
    if (PROVIDER_INFO[base]) return base
  }
  return provider
}

// ─── Config errors ──────────────────────────────────────────────────

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

// ─── Validation ─────────────────────────────────────────────────────

export function validateConfig(raw: Record<string, unknown>): UltimatrixConfig {
  const errors: string[] = []

  // Required: provider
  const provider = raw.provider as string | undefined
  if (!provider || typeof provider !== 'string') {
    errors.push('provider is required (e.g., "groq", "openai", "anthropic")')
  } else if (!PROVIDER_INFO[provider]) {
    errors.push(`unknown provider "${provider}". supported: ${Object.keys(PROVIDER_INFO).join(', ')}`)
  }

  // Required: model
  const model = raw.model as string | undefined
  if (!model || typeof model !== 'string') {
    errors.push('model is required (e.g., "llama3-8b-8192", "gpt-4o")')
  }

  // Target: optional in YAML, can be provided via CLI -t flag or env TARGET
  const target = raw.target as string | undefined
  if (target && typeof target !== 'string') {
    errors.push('target must be a string (e.g., "https://example.com")')
  }

  // Required: creds for the primary provider
  const creds = (raw.creds ?? {}) as ProviderCredentials
  if (provider && PROVIDER_INFO[provider]) {
    const providerCreds = creds[provider]
    if (!providerCreds) {
      errors.push(`creds.${provider} is required — set apiKey for ${provider}`)
    } else if ('apiKey' in providerCreds && !providerCreds.apiKey) {
      errors.push(`creds.${provider}.apiKey is required`)
    } else if (provider === 'azure') {
      const az = providerCreds as AzureCreds
      if (!az.endpoint) errors.push('creds.azure.endpoint is required')
      if (!az.deployment) errors.push('creds.azure.deployment is required')
    } else if (provider === 'bedrock') {
      const br = providerCreds as BedrockCreds
      if (br.authMethod === 'iam') {
        if (!br.accessKeyId) errors.push('creds.bedrock.accessKeyId is required for IAM auth')
        if (!br.secretAccessKey) errors.push('creds.bedrock.secretAccessKey is required for IAM auth')
      } else if (!br.apiKey) {
        errors.push('creds.bedrock.apiKey is required for api_key auth')
      }
    } else if (provider === 'custom') {
      const cu = providerCreds as CustomCreds
      if (!cu.baseUrl) errors.push('creds.custom.baseUrl is required')
    }
  }

  // Validate scope config.
  // `allowedDomains` is OPTIONAL. Scope is only enforced when the user
  // explicitly provides a non-empty list — otherwise the tool is free-for-all
  // (no domain restriction). An empty array is also treated as free-for-all.
  const scopeRaw = raw.scope as Record<string, unknown> | undefined
  if (scopeRaw) {
    if (scopeRaw.allowedDomains !== undefined) {
      if (!Array.isArray(scopeRaw.allowedDomains)) {
        errors.push('scope.allowedDomains must be an array of domain strings')
      } else {
        for (const d of scopeRaw.allowedDomains) {
          if (typeof d !== 'string' || d.length === 0) {
            errors.push(`scope.allowedDomains contains invalid entry: ${JSON.stringify(d)}`)
          }
        }
      }
    }
    if (scopeRaw.enforcement !== undefined && scopeRaw.enforcement !== 'hard' && scopeRaw.enforcement !== 'warn') {
      errors.push(`scope.enforcement must be "hard" or "warn", got "${scopeRaw.enforcement}"`)
    }
    if (scopeRaw.allowedProtocols !== undefined) {
      if (!Array.isArray(scopeRaw.allowedProtocols)) {
        errors.push('scope.allowedProtocols must be an array of protocol strings')
      }
    }
    if (scopeRaw.allowedPaths !== undefined) {
      if (!Array.isArray(scopeRaw.allowedPaths)) {
        errors.push('scope.allowedPaths must be an array of path strings')
      }
    }
  }

  // Validate engine
  const engine = raw.engine as EngineType | undefined
  if (engine !== undefined && engine !== 'legacy' && engine !== 'solver' && engine !== 'multi-model' && engine !== 'council') {
    errors.push(`engine must be "multi-model", "council", or "solver" (deprecated), got "${engine}"`)
  }

  // Deprecation: 'council' engine → coerce to 'multi-model' with warning.
  // 'solver' is a legacy alias for 'multi-model'. Rigid config→config map.
  const resolvedEngine = engine ? ENGINE_COERCION[engine] : engine
  if (engine === 'council') {
    console.warn('[ultimatrix] DEPRECATION: engine: council is deprecated. Council is now a REPL command — use engine: multi-model and type /council <goal> at the prompt.')
  }

  // Validate solver config
  const solverRaw = raw.solver as Record<string, unknown> | undefined
  if (solverRaw) {
    for (const key of ['maxToolCalls', 'maxTokens', 'maxDurationMs', 'maxParallel'] as const) {
      const val = solverRaw[key]
      if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val < 1)) {
        errors.push(`solver.${key} must be a positive number, got ${JSON.stringify(val)}`)
      }
    }
  }

  // Validate antiLoop config
  const antiLoopRaw = raw.antiLoop as Record<string, unknown> | undefined
  if (antiLoopRaw) {
    for (const key of ['staleThreshold', 'maxFailedTarget'] as const) {
      const val = antiLoopRaw[key]
      if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val < 1)) {
        errors.push(`antiLoop.${key} must be a positive number, got ${JSON.stringify(val)}`)
      }
    }
  }

  // Validate reflexion config
  const reflexionRaw = raw.reflexion as Record<string, unknown> | undefined
  if (reflexionRaw) {
    for (const key of ['maxSameVulnFails', 'maxTotalNoProgress', 'escalationMaxLevel'] as const) {
      const val = reflexionRaw[key]
      if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val < 1)) {
        errors.push(`reflexion.${key} must be a positive number, got ${JSON.stringify(val)}`)
      }
    }
    if (reflexionRaw.enabled !== undefined && typeof reflexionRaw.enabled !== 'boolean') {
      errors.push(`reflexion.enabled must be a boolean, got ${JSON.stringify(reflexionRaw.enabled)}`)
    }
  }

  // Validate modelTiers provider creds if specified
  const modelTiers = raw.modelTiers as Record<string, unknown> | undefined
  if (modelTiers) {
    for (const tier of ['fast', 'balanced', 'powerful'] as const) {
      const tierVal = modelTiers[tier]
      if (tierVal && typeof tierVal === 'string') {
        // Backward compat: "provider/model" string
        const tierProvider = tierVal.includes('/') ? tierVal.split('/')[0] : provider
        if (tierProvider && !creds[tierProvider]) {
          errors.push(`creds.${tierProvider} is required for modelTiers.${tier} = "${tierVal}"`)
        }
      } else if (tierVal && typeof tierVal === 'object' && 'provider' in tierVal && 'model' in tierVal) {
        const tierCfg = tierVal as { provider: string; model: string }
        if (tierCfg.provider && !creds[tierCfg.provider]) {
          errors.push(`creds.${tierCfg.provider} is required for modelTiers.${tier}`)
        }
      }
    }
  }

  // Validate budgetPolicy
  const budgetRaw = raw.budgetPolicy as Record<string, unknown> | undefined
  if (budgetRaw) {
    const alloc = budgetRaw.allocation as Record<string, unknown> | undefined
    if (alloc) {
      const sum = Number(alloc.brain ?? 0.3) + Number(alloc.workers ?? 0.6) + Number(alloc.spider ?? 0.1)
      if (sum > 1.0) {
        errors.push(`budgetPolicy.allocation sums to ${sum} (must be <= 1.0)`)
      }
    }
    if (budgetRaw.maxModelCallsPerTask !== undefined) {
      const v = Number(budgetRaw.maxModelCallsPerTask)
      if (!Number.isFinite(v) || v < 1) errors.push(`budgetPolicy.maxModelCallsPerTask must be positive`)
    }
    if (budgetRaw.maxTokensPerSession !== undefined) {
      const v = Number(budgetRaw.maxTokensPerSession)
      if (!Number.isFinite(v) || v < 1) errors.push(`budgetPolicy.maxTokensPerSession must be positive`)
    }
    if (budgetRaw.scope !== undefined && budgetRaw.scope !== 'turn' && budgetRaw.scope !== 'session') {
      errors.push(`budgetPolicy.scope must be "turn" or "session"`)
    }
    if (budgetRaw.resetOn !== undefined && budgetRaw.resetOn !== 'turn' && budgetRaw.resetOn !== 'never') {
      errors.push(`budgetPolicy.resetOn must be "turn" or "never"`)
    }
    if (budgetRaw.enforcement !== undefined && !['hard', 'soft', 'warn'].includes(budgetRaw.enforcement as string)) {
      errors.push(`budgetPolicy.enforcement must be "hard", "soft", or "warn"`)
    }
  }

  // Validate providerRateLimits
  const providerRlRaw = raw.providerRateLimits as Record<string, unknown> | undefined
  if (providerRlRaw) {
    for (const [prov, rlEntry] of Object.entries(providerRlRaw)) {
      const rl = rlEntry as Record<string, unknown>
      if (rl.requestsPerMinute !== undefined && Number(rl.requestsPerMinute) <= 0) {
        errors.push(`providerRateLimits.${prov}.requestsPerMinute must be positive`)
      }
      if (rl.tokensPerMinute !== undefined && Number(rl.tokensPerMinute) <= 0) {
        errors.push(`providerRateLimits.${prov}.tokensPerMinute must be positive`)
      }
    }
  }

  // Parse modelTiers — normalize string format to TierConfig objects
  let parsedTiers: ModelTiers | undefined
  if (modelTiers) {
    parsedTiers = {}
    for (const tier of ['fast', 'balanced', 'powerful'] as const) {
      const val = modelTiers[tier]
      if (val && typeof val === 'string') {
        // Backward compat: "provider/model" string → TierConfig
        const slashIdx = val.indexOf('/')
        parsedTiers[tier] = {
          provider: slashIdx !== -1 ? val.slice(0, slashIdx) : provider,
          model: slashIdx !== -1 ? val.slice(slashIdx + 1) : val,
        }
      } else if (val && typeof val === 'object' && 'provider' in val && 'model' in val) {
        parsedTiers[tier] = val as TierConfig
      }
    }
    // Only set if at least one tier exists
    if (Object.keys(parsedTiers).length === 0) parsedTiers = undefined
  }

  // Validate modelCapabilities
  const modelCapsRaw = raw.modelCapabilities as Record<string, unknown> | undefined
  if (modelCapsRaw) {
    for (const [modelId, capRaw] of Object.entries(modelCapsRaw)) {
      const cap = capRaw as Record<string, unknown>
      if (!cap || typeof cap !== 'object') {
        errors.push(`modelCapabilities.${modelId} must be an object`)
        continue
      }
      if (typeof cap.contextWindow !== 'number' || !Number.isFinite(cap.contextWindow) || cap.contextWindow <= 0) {
        errors.push(`modelCapabilities.${modelId}.contextWindow must be a positive number`)
      }
      if (typeof cap.maxOutputTokens !== 'number' || !Number.isFinite(cap.maxOutputTokens) || cap.maxOutputTokens < 0) {
        errors.push(`modelCapabilities.${modelId}.maxOutputTokens must be a non-negative number`)
      }
    }
  }

  // Validate spider
  const spiderRaw = raw.spider as Record<string, unknown> | undefined
  if (spiderRaw) {
    if (spiderRaw.enabled !== undefined && typeof spiderRaw.enabled !== 'boolean') {
      errors.push('spider.enabled must be a boolean')
    }
    if (spiderRaw.maxSteps !== undefined && (typeof spiderRaw.maxSteps !== 'number' || spiderRaw.maxSteps < 1)) {
      errors.push('spider.maxSteps must be a positive number')
    }
    if (spiderRaw.maxDurationMs !== undefined && (typeof spiderRaw.maxDurationMs !== 'number' || spiderRaw.maxDurationMs < 1)) {
      errors.push('spider.maxDurationMs must be a positive number')
    }
  }

  // Validate verifier
  const verifierRaw = raw.verifier as Record<string, unknown> | undefined
  if (verifierRaw) {
    if (verifierRaw.enabled !== undefined && typeof verifierRaw.enabled !== 'boolean') {
      errors.push('verifier.enabled must be a boolean')
    }
    if (verifierRaw.maxPerRound !== undefined && (typeof verifierRaw.maxPerRound !== 'number' || verifierRaw.maxPerRound < 1)) {
      errors.push('verifier.maxPerRound must be a positive number')
    }
    if (verifierRaw.timeoutMs !== undefined && (typeof verifierRaw.timeoutMs !== 'number' || verifierRaw.timeoutMs < 1)) {
      errors.push('verifier.timeoutMs must be a positive number')
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(`Config validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`)
  }

  // Build config with user-provided or sensible values for non-LLM fields
  const depth = raw.depth != null ? Number(raw.depth) : DEFAULTS.depth
  const timeout = raw.timeout != null ? Number(raw.timeout) : DEFAULTS.timeout
  const browserRaw = (raw.browser ?? {}) as Record<string, unknown>
  const memoryRaw = (raw.memory ?? {}) as Record<string, unknown>
  const agentRaw = (raw.agent ?? {}) as Record<string, unknown>
  const rateLimitRaw = (raw.rateLimit ?? {}) as Record<string, unknown>

  return {
    provider: provider!,
    model: model!,
    ...(target ? { target } : {}),
    depth,
    timeout,
    creds,
    modelTiers: parsedTiers,
    browser: {
      headless: browserRaw.headless != null ? Boolean(browserRaw.headless) : DEFAULTS.browser.headless,
      viewport: {
        width: Number(browserRaw.viewport && typeof browserRaw.viewport === 'object'
          ? (browserRaw.viewport as Record<string, unknown>).width ?? DEFAULTS.browser.viewport.width : DEFAULTS.browser.viewport.width),
        height: Number(browserRaw.viewport && typeof browserRaw.viewport === 'object'
          ? (browserRaw.viewport as Record<string, unknown>).height ?? DEFAULTS.browser.viewport.height : DEFAULTS.browser.viewport.height),
      },
      domSettleTimeout: Number(browserRaw.domSettleTimeout ?? DEFAULTS.browser.domSettleTimeout),
      env: String(browserRaw.env ?? DEFAULTS.browser.env),
      selfHeal: browserRaw.selfHeal != null ? Boolean(browserRaw.selfHeal) : DEFAULTS.browser.selfHeal,
      verbose: Number(browserRaw.verbose ?? DEFAULTS.browser.verbose),
    },
    memory: {
      lastMessages: Number(memoryRaw.lastMessages ?? DEFAULTS.memory.lastMessages),
      semanticRecall: Boolean(memoryRaw.semanticRecall ?? DEFAULTS.memory.semanticRecall),
      workingMemory: Boolean(memoryRaw.workingMemory ?? DEFAULTS.memory.workingMemory),
    },
    agent: {
      maxSteps: Number(agentRaw.maxSteps ?? DEFAULTS.agent.maxSteps),
      scansDir: String(agentRaw.scansDir ?? DEFAULTS.agent.scansDir),
    },
    rateLimit: {
      requestsPerMinute: Number(rateLimitRaw.requestsPerMinute ?? DEFAULTS.rateLimit.requestsPerMinute),
      maxConcurrent: Number(rateLimitRaw.maxConcurrent ?? DEFAULTS.rateLimit.maxConcurrent),
      retryOnLimit: rateLimitRaw.retryOnLimit != null ? Boolean(rateLimitRaw.retryOnLimit) : DEFAULTS.rateLimit.retryOnLimit,
      maxRetries: Number(rateLimitRaw.maxRetries ?? DEFAULTS.rateLimit.maxRetries),
      backoffStrategy: String(rateLimitRaw.backoffStrategy ?? DEFAULTS.rateLimit.backoffStrategy),
      backoffSteps: Array.isArray(rateLimitRaw.backoffSteps) ? rateLimitRaw.backoffSteps.map(Number) : [...DEFAULTS.rateLimit.backoffSteps],
      baseBackoffMs: Number(rateLimitRaw.baseBackoffMs ?? DEFAULTS.rateLimit.baseBackoffMs),
      maxBackoffMs: Number(rateLimitRaw.maxBackoffMs ?? DEFAULTS.rateLimit.maxBackoffMs),
      useHeaders: rateLimitRaw.useHeaders != null ? Boolean(rateLimitRaw.useHeaders) : DEFAULTS.rateLimit.useHeaders,
    },
    engine: (resolvedEngine as EngineType) || DEFAULTS.engine,
    ...(solverRaw ? {
      solver: {
        ...(solverRaw.maxToolCalls != null ? { maxToolCalls: Number(solverRaw.maxToolCalls) } : {}),
        ...(solverRaw.maxTokens != null ? { maxTokens: Number(solverRaw.maxTokens) } : {}),
        ...(solverRaw.maxDurationMs != null ? { maxDurationMs: Number(solverRaw.maxDurationMs) } : {}),
        ...(solverRaw.maxParallel != null ? { maxParallel: Number(solverRaw.maxParallel) } : {}),
      },
    } : {}),
    ...(antiLoopRaw ? {
      antiLoop: {
        ...(antiLoopRaw.staleThreshold != null ? { staleThreshold: Number(antiLoopRaw.staleThreshold) } : {}),
        ...(antiLoopRaw.maxFailedTarget != null ? { maxFailedTarget: Number(antiLoopRaw.maxFailedTarget) } : {}),
      },
    } : {}),
    ...(reflexionRaw ? {
      reflexion: {
        ...(reflexionRaw.enabled != null ? { enabled: Boolean(reflexionRaw.enabled) } : {}),
        ...(reflexionRaw.maxSameVulnFails != null ? { maxSameVulnFails: Number(reflexionRaw.maxSameVulnFails) } : {}),
        ...(reflexionRaw.maxTotalNoProgress != null ? { maxTotalNoProgress: Number(reflexionRaw.maxTotalNoProgress) } : {}),
        ...(reflexionRaw.escalationMaxLevel != null ? { escalationMaxLevel: Number(reflexionRaw.escalationMaxLevel) } : {}),
      },
    } : {}),
    // v8 multi-model fields
    ...(budgetRaw ? {
      budgetPolicy: {
        enforcement: (budgetRaw.enforcement as BudgetPolicy['enforcement']) || DEFAULTS.budgetPolicy.enforcement,
        scope: (budgetRaw.scope as BudgetPolicy['scope']) || DEFAULTS.budgetPolicy.scope,
        resetOn: (budgetRaw.resetOn as BudgetPolicy['resetOn']) || DEFAULTS.budgetPolicy.resetOn,
        allocation: {
          brain: Number((budgetRaw.allocation as Record<string, unknown>)?.brain ?? DEFAULTS.budgetPolicy.allocation.brain),
          workers: Number((budgetRaw.allocation as Record<string, unknown>)?.workers ?? DEFAULTS.budgetPolicy.allocation.workers),
          spider: Number((budgetRaw.allocation as Record<string, unknown>)?.spider ?? DEFAULTS.budgetPolicy.allocation.spider),
        },
        maxModelCallsPerTask: Number(budgetRaw.maxModelCallsPerTask ?? DEFAULTS.budgetPolicy.maxModelCallsPerTask),
        ...(budgetRaw.maxTokensPerSession != null ? { maxTokensPerSession: Number(budgetRaw.maxTokensPerSession) } : {}),
        trackTokens: budgetRaw.trackTokens != null ? Boolean(budgetRaw.trackTokens) : DEFAULTS.budgetPolicy.trackTokens,
      } as BudgetPolicy,
    } : { budgetPolicy: DEFAULTS.budgetPolicy }),
    ...(modelCapsRaw ? { modelCapabilities: modelCapsRaw as ModelCapabilities } : {}),
    ...(providerRlRaw && Object.keys(providerRlRaw).length > 0 ? { providerRateLimits: providerRlRaw as ProviderRateLimits } : {}),
    // Optional config blocks
    ...(spiderRaw ? {
      spider: {
        ...(spiderRaw.enabled != null ? { enabled: Boolean(spiderRaw.enabled) } : {}),
        ...(spiderRaw.maxSteps != null ? { maxSteps: Number(spiderRaw.maxSteps) } : {}),
        ...(spiderRaw.maxDurationMs != null ? { maxDurationMs: Number(spiderRaw.maxDurationMs) } : {}),
      },
    } : {}),
    ...(verifierRaw ? {
      verifier: {
        ...(verifierRaw.enabled != null ? { enabled: Boolean(verifierRaw.enabled) } : {}),
        ...(verifierRaw.maxPerRound != null ? { maxPerRound: Number(verifierRaw.maxPerRound) } : {}),
        ...(verifierRaw.timeoutMs != null ? { timeoutMs: Number(verifierRaw.timeoutMs) } : {}),
      },
    } : DEFAULTS.verifier ? { verifier: DEFAULTS.verifier } : {}),
    ...(raw.authorization ? { authorization: raw.authorization as AuthorizationConfig } : {}),
    ...(raw.scope ? { scope: raw.scope as ScopeConfig } : {}),
    ...(raw.campaign ? { campaign: raw.campaign as CampaignConfig } : {}),
    ...(raw.oast ? { oast: raw.oast as OastConfig } : {}),
    ...(Array.isArray(raw.mcp) ? { mcp: raw.mcp as McpServerConfig[] } : {}),
    ...(Array.isArray(raw.plugins) ? { plugins: raw.plugins as PluginConfig[] } : {}),
    ...(Array.isArray(raw.skillsDirs) ? { skillsDirs: raw.skillsDirs as string[] } : {}),
    ...(raw.skills ? { skills: raw.skills as { exclude?: string[] } } : {}),
  }
}

// ─── YAML helpers ───────────────────────────────────────────────────

function providersYamlPath(): string {
  return join(homedir(), '.config', 'ultimatrix', 'providers.yaml')
}

function ultimatrixYamlPath(): string {
  return resolve('ultimatrix.yaml')
}

function loadYamlFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = load(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

// ─── Load config ────────────────────────────────────────────────────

export function loadConfig(): UltimatrixConfig {
  const yamlConfig = loadYamlFile(ultimatrixYamlPath()) ?? {}
  let providersYaml = loadYamlFile(providersYamlPath())

  // Merge env-sourced creds into providers yaml creds
  if (providersYaml) {
    for (const [id, info] of Object.entries(PROVIDER_INFO)) {
      const envKey = process.env[info.envVar]
      if (envKey && !providersYaml[id]) {
        providersYaml[id] = { apiKey: envKey }
      } else if (envKey && providersYaml[id] && typeof providersYaml[id] === 'object') {
        const entry = providersYaml[id] as Record<string, unknown>
        if (!entry.apiKey) entry.apiKey = envKey
      }
    }
  } else {
    // No providers.yaml — build providers from env vars only
    const built: Record<string, unknown> = {}
    for (const [id, info] of Object.entries(PROVIDER_INFO)) {
      const envKey = process.env[info.envVar]
      if (envKey) built[id] = { apiKey: envKey }
    }
    if (Object.keys(built).length > 0) {
      providersYaml = built
    }
  }

  // Build creds from providers.yaml + env vars
  const creds: ProviderCredentials = {}
  if (providersYaml) {
    for (const [provider, entry] of Object.entries(providersYaml)) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>

      if (provider === 'azure') {
        creds.azure = {
          apiKey: String(e.apiKey ?? ''),
          endpoint: String(e.endpoint ?? ''),
          deployment: String(e.deployment ?? ''),
          apiVersion: String(e.apiVersion ?? '2024-10-21'),
        }
      } else if (provider === 'bedrock') {
        creds.bedrock = {
          authMethod: (e.authMethod as 'iam' | 'api_key') || (e.apiKey ? 'api_key' : 'iam'),
          accessKeyId: String(e.accessKeyId ?? ''),
          secretAccessKey: String(e.secretAccessKey ?? ''),
          sessionToken: e.sessionToken ? String(e.sessionToken) : undefined,
          region: String(e.region ?? ''),
          apiKey: e.apiKey ? String(e.apiKey) : undefined,
        }
      } else if (provider === 'custom') {
        creds.custom = {
          apiKey: String(e.apiKey ?? ''),
          baseUrl: String(e.baseUrl ?? ''),
        }
      } else {
        const apiKey = String(e.apiKey ?? e.api_key ?? e.key ?? '')
        const baseUrl = String(e.baseUrl ?? e.base_url ?? e.endpoint ?? '')
        if (apiKey || baseUrl) {
          creds[provider] = { apiKey, ...(baseUrl ? { baseUrl } : {}) }
        }
      }
    }
  }

  // Also check env vars directly for any provider not in providers.yaml
  for (const [id, info] of Object.entries(PROVIDER_INFO)) {
    if (!creds[id]) {
      const envKey = process.env[info.envVar]
      if (envKey) {
        creds[id] = { apiKey: envKey }
      }
    }
  }

  // Merge providerKeys (same-provider different API keys) into creds
  const providerKeysRaw = yamlConfig.providerKeys as Record<string, { apiKey?: string; baseUrl?: string }> | undefined
  if (providerKeysRaw) {
    for (const [alias, entry] of Object.entries(providerKeysRaw)) {
      if (entry && typeof entry === 'object' && entry.apiKey) {
        creds[alias] = { apiKey: entry.apiKey, ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}) }
      }
    }
  }

  // Apply env var overrides
  const providerFromEnv = process.env.LLM_PROVIDER
  const modelFromEnv = process.env.LLM_MODEL
  const targetFromEnv = process.env.TARGET

  const merged: Record<string, unknown> = {
    ...yamlConfig,
    ...(providerFromEnv ? { provider: providerFromEnv } : {}),
    ...(modelFromEnv ? { model: modelFromEnv } : {}),
    ...(targetFromEnv ? { target: targetFromEnv } : {}),
    ...(process.env.DEPTH ? { depth: Number(process.env.DEPTH) } : {}),
    ...(process.env.TIMEOUT ? { timeout: Number(process.env.TIMEOUT) } : {}),
    ...(process.env.HEADLESS ? { headless: process.env.HEADLESS !== 'false' } : {}),
    creds,
  }

  return validateConfig(merged)
}

let _cachedConfig: UltimatrixConfig | null = null

/**
 * Cached access to the active session config. `loadConfig` re-reads + re-validates
 * YAML on every call, which is wasteful for tools that need to read a single field
 * (e.g. the credential tool). The cache is intentionally module-scoped for the
 * process lifetime; tests reset it via `resetConfigCache()`.
 */
export function getConfig(): UltimatrixConfig {
  if (!_cachedConfig) _cachedConfig = loadConfig()
  return _cachedConfig
}

export function resetConfigCache(): void {
  _cachedConfig = null
}

// ─── Save helpers ───────────────────────────────────────────────────

export function saveProvidersConfig(creds: ProviderCredentials): void {
  const path = providersYamlPath()
  const dir = path.substring(0, path.lastIndexOf('\\'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const data: Record<string, unknown> = {}
  for (const [provider, entry] of Object.entries(creds)) {
    if (!entry) continue
    if (provider === 'azure') {
      const az = entry as AzureCreds
      data.azure = { apiKey: az.apiKey, endpoint: az.endpoint, deployment: az.deployment, apiVersion: az.apiVersion }
    } else if (provider === 'bedrock') {
      const br = entry as BedrockCreds
      data.bedrock = { authMethod: br.authMethod, accessKeyId: br.accessKeyId, secretAccessKey: br.secretAccessKey, sessionToken: br.sessionToken, region: br.region, apiKey: br.apiKey }
    } else if (provider === 'custom') {
      const cu = entry as CustomCreds
      data.custom = { apiKey: cu.apiKey, baseUrl: cu.baseUrl }
    } else {
      const ac = entry as ApiKeyCreds
      data[provider] = { apiKey: ac.apiKey, baseUrl: ac.baseUrl }
    }
  }

  writeFileSync(path, dump(data), 'utf-8')
}

export function saveProjectConfig(config: UltimatrixConfig): void {
  const path = ultimatrixYamlPath()

  // Strip creds from YAML output (they go in providers.yaml)
  const output: Record<string, unknown> = {
    provider: config.provider,
    model: config.model,
    target: config.target,
    depth: config.depth,
    timeout: config.timeout,
  }

  if (config.modelTiers && Object.keys(config.modelTiers).length > 0) {
    const tiers: Record<string, { provider: string; model: string }> = {}
    for (const [tier, tierCfg] of Object.entries(config.modelTiers)) {
      if (tierCfg) tiers[tier] = { provider: tierCfg.provider, model: tierCfg.model }
    }
    output.modelTiers = tiers
  }

  // Write non-default browser config
  const b = config.browser
  if (!b.headless || b.viewport.width !== 1280 || b.viewport.height !== 720 ||
      b.domSettleTimeout !== 5000 || b.env !== 'LOCAL' || !b.selfHeal || b.verbose !== 0) {
    output.browser = {
      headless: b.headless,
      viewport: b.viewport,
      domSettleTimeout: b.domSettleTimeout,
      env: b.env,
      selfHeal: b.selfHeal,
      verbose: b.verbose,
    }
  }

  // Write non-default memory config
  const m = config.memory
  if (m.lastMessages !== 10 || m.semanticRecall !== false || m.workingMemory !== true) {
    output.memory = {
      lastMessages: m.lastMessages,
      semanticRecall: m.semanticRecall,
      workingMemory: m.workingMemory,
    }
  }

  // Write non-default agent config
  const a = config.agent
  if (a.maxSteps !== DEFAULTS.agent.maxSteps || a.scansDir !== DEFAULTS.agent.scansDir) {
    output.agent = {
      maxSteps: a.maxSteps,
      scansDir: a.scansDir,
    }
  }

  // Write non-default rate limit config
  const rl = config.rateLimit
  if (rl.requestsPerMinute !== 15 || rl.maxConcurrent !== 2 || rl.retryOnLimit !== true || rl.maxRetries !== 3) {
    output.rateLimit = {
      requestsPerMinute: rl.requestsPerMinute,
      maxConcurrent: rl.maxConcurrent,
      retryOnLimit: rl.retryOnLimit,
      maxRetries: rl.maxRetries,
    }
  }

  // Write scope config if set
  if (config.scope) {
    output.scope = {
      allowedDomains: config.scope.allowedDomains,
      enforcement: config.scope.enforcement,
      ...(config.scope.allowedPaths && config.scope.allowedPaths.length > 0 ? { allowedPaths: config.scope.allowedPaths } : {}),
      ...(config.scope.allowedProtocols && config.scope.allowedProtocols.length > 0 ? { allowedProtocols: config.scope.allowedProtocols } : {}),
    }
  }

  // Write budgetPolicy if non-default
  if (config.budgetPolicy) {
    const bp = config.budgetPolicy
    if (bp.enforcement !== 'soft' || bp.scope !== 'session' || bp.resetOn !== 'never' ||
        bp.allocation.brain !== 0.3 || bp.allocation.workers !== 0.6 || bp.allocation.spider !== 0.1 ||
        bp.maxModelCallsPerTask !== 15 || bp.trackTokens !== false) {
      output.budgetPolicy = {
        enforcement: bp.enforcement,
        scope: bp.scope,
        resetOn: bp.resetOn,
        allocation: bp.allocation,
        maxModelCallsPerTask: bp.maxModelCallsPerTask,
        ...(bp.maxTokensPerSession ? { maxTokensPerSession: bp.maxTokensPerSession } : {}),
        trackTokens: bp.trackTokens,
      }
    }
  }

  // Write providerRateLimits if set
  if (config.providerRateLimits && Object.keys(config.providerRateLimits).length > 0) {
    output.providerRateLimits = config.providerRateLimits
  }

  // Write modelCapabilities if set
  if (config.modelCapabilities && Object.keys(config.modelCapabilities).length > 0) {
    output.modelCapabilities = config.modelCapabilities
  }

  writeFileSync(path, dump(output), 'utf-8')
}


