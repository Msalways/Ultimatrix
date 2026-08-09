import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import { load, dump } from 'js-yaml'
import { randomBytes } from 'crypto'

// ─── Config file I/O helpers ────────────────────────────────────────

/** Ensure the parent directory of a file path exists. */
function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Atomic write: write to a temp file, then rename. Prevents corruption
 * on crash/power-loss and handles Windows EPERM/EBUSY from file watchers.
 */
function atomicWrite(filePath: string, content: string): void {
  ensureDir(filePath)
  const tmpPath = `${filePath}.tmp.${randomBytes(4).toString('hex')}`
  try {
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, filePath)
  } catch (err) {
    // Clean up temp file on failure
    try { unlinkSync(tmpPath) } catch { /* best effort */ }
    throw err
  }
}

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
  cohere?: ApiKeyCreds
  ollama?: ApiKeyCreds
  [key: string]: ApiKeyCreds | AzureCreds | BedrockCreds | CustomCreds | undefined
}

// ─── Config interface ───────────────────────────────────────────────

export interface BrowserConfig {
  provider?: 'stagehand'
  headless: boolean
  viewport: { width: number; height: number }
  domSettleTimeout: number
  env: string
  selfHeal: boolean
  verbose: number
  sessionScope?: 'workflow'
}

export interface MemoryConfig {
  lastMessages: number
  semanticRecall: boolean | {
    topK?: number
    messageRange?: number
    scope?: 'thread' | 'resource'
  }
  workingMemory: boolean
  vector?: {
    enabled: boolean
    url?: string
  }
  embedder?: {
    provider: string
    model: string
  }
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
  maxOutputTokens?: number
}

export interface ModelTiers {
  fast?: TierConfig
  balanced?: TierConfig
  powerful?: TierConfig
}

export type TaskComplexity = 'low' | 'medium' | 'high' | 'critical'

export interface ModelRoles {
  brain?: TierConfig
  spider?: TierConfig
  crawlSummarizer?: TierConfig
  worker?: Partial<Record<TaskComplexity, TierConfig>>
  verifier?: TierConfig
  reporter?: TierConfig
  council?: TierConfig
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
  maxPages?: number
  maxDepth?: number
  maxDurationMs?: number
  authAware?: boolean
  boundaryMode?: 'claim-based'
}

export interface ExternalToolsConfig {
  enabled?: boolean
  tools?: Partial<Record<'nmap' | 'arjun' | 'sqlmap' | 'nuclei' | 'ffuf' | 'jwttool' | 'corsy' | 'subfinder' | 'gitleaks', boolean>>
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
  /** Safety margin subtracted from contextWindow when checking fits. Default 1024. */
  reservedMargin?: number
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
    vector: { enabled: false },
  },
  browser: {
    provider: 'stagehand',
    headless: true,
    viewport: { width: 1280, height: 720 },
    domSettleTimeout: 5000,
    env: 'LOCAL',
    selfHeal: true,
    verbose: 0,
    sessionScope: 'workflow',
  },
  spider: {
    enabled: true,
    maxPages: 100,
    maxDepth: 2,
    maxDurationMs: 120_000,
    authAware: true,
    boundaryMode: 'claim-based',
  },
  externalTools: {
    enabled: false,
    tools: {},
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
      enabled: false,
      tokenBudget: 100000,
      fallbackToTruncation: true,
      maxResponseSize: 50000,
      model: 'gpt-4o',
    },
  },
  truncation: {
    maxResponseSize: 50000,
    fallbackEnabled: true,
  },
} as const

// ─── Context window config types (Phase 1 gap fix) ───────────────────────

export interface ContextConfig {
  /** Maximum number of endpoints included in graph summaries sent to LLM. Default: 10. */
  maxEndpointsInSummary?: number
  /** Maximum number of findings displayed per discovery line. Default: 20. */
  maxFindingsPerTurn?: number
  /** Maximum number of facts in blackboard before pruning. Default: 100. */
  maxBlackboardFactsInSummary?: number
}

// ─── Config interface ───────────────────────────────────────────────

export interface UltimatrixConfig {
  provider: string
  model: string
  target?: string
  depth: number
  timeout: number
  creds: ProviderCredentials
  modelTiers?: ModelTiers
  modelRoles?: ModelRoles
  browser: BrowserConfig
  memory: MemoryConfig
  agent: AgentConfig
  rateLimit: RateLimitConfig
  authorization?: AuthorizationConfig
  scope?: ScopeConfig
  engine?: EngineType
  solver?: SolverConfig
  spider?: SpiderConfig
  externalTools?: ExternalToolsConfig
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
  /** Phase 1 gap fix: Context window management. */
  context?: ContextConfig
  /** Test account credentials keyed by role name (e.g. { admin: { email, password } }). */
  credentials?: Record<string, { email: string; password: string }>
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

/**
 * @deprecated Use `config.modelCapabilities` instead. This hardcoded map
 * goes stale whenever a provider ships a new model. Will be removed in v9.
 */
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

/**
 * @deprecated Use `ContextWindowRegistry` instead. This function reads from
 * the deprecated `CONTEXT_WINDOW_MAP`. Will be removed in v9.
 */
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
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    defaultBaseUrl: 'https://api.cohere.com/v2',
    envVar: 'COHERE_API_KEY',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    envVar: 'OLLAMA_API_KEY',
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

export interface ConfigValidationOptions {
  /** Allow the settings UI to load an incomplete config so credentials can be repaired. */
  requireCredentials?: boolean
}

function parseTierConfigValue(
  val: unknown,
  fallbackProvider: string,
): TierConfig | undefined {
  if (!val) return undefined
  if (typeof val === 'string') {
    const slashIdx = val.indexOf('/')
    return {
      provider: slashIdx !== -1 ? val.slice(0, slashIdx) : fallbackProvider,
      model: slashIdx !== -1 ? val.slice(slashIdx + 1) : val,
    }
  }
  if (typeof val === 'object' && 'provider' in val && 'model' in val) {
    const obj = val as Record<string, unknown>
    return {
      provider: String(obj.provider),
      model: String(obj.model),
      ...(obj.maxOutputTokens != null ? { maxOutputTokens: Number(obj.maxOutputTokens) } : {}),
    }
  }
  return undefined
}

function validateTierConfigValue(path: string, val: unknown, errors: string[]): void {
  if (!val) return
  if (typeof val === 'string') return
  if (typeof val !== 'object') {
    errors.push(`${path} must be "provider/model" or an object with provider and model`)
    return
  }
  const obj = val as Record<string, unknown>
  if (typeof obj.provider !== 'string' || obj.provider.length === 0) errors.push(`${path}.provider must be a non-empty string`)
  if (typeof obj.model !== 'string' || obj.model.length === 0) errors.push(`${path}.model must be a non-empty string`)
  if (obj.maxOutputTokens !== undefined) {
    const maxOutputTokens = Number(obj.maxOutputTokens)
    if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < 1) errors.push(`${path}.maxOutputTokens must be a positive number`)
  }
}

export function validateConfig(
  raw: Record<string, unknown>,
  options: ConfigValidationOptions = {},
): UltimatrixConfig {
  const errors: string[] = []
  const requireCredentials = options.requireCredentials !== false

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

  // Target is optional in YAML and may be supplied as an explicit CLI/web session input.
  const target = raw.target as string | undefined
  if (target && typeof target !== 'string') {
    errors.push('target must be a string (e.g., "https://example.com")')
  } else if (target) {
    try {
      const parsedTarget = new URL(target)
      if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
        errors.push('target must use http or https')
      }
    } catch {
      errors.push('target must be a valid URL (e.g., "https://example.com")')
    }
  }

  const testCredentials = raw.credentials as Record<string, { email?: unknown; password?: unknown }> | undefined
  if (testCredentials) {
    for (const [role, entry] of Object.entries(testCredentials)) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`credentials.${role} must be an object`)
        continue
      }
      if (typeof entry.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)) {
        errors.push(`credentials.${role}.email must be a valid email address`)
      }
      if (typeof entry.password !== 'string' || entry.password.length === 0) {
        errors.push(`credentials.${role}.password is required`)
      }
    }
  }

  // Required: creds for the primary provider
  const creds = (raw.creds ?? {}) as ProviderCredentials
  if (requireCredentials && provider && PROVIDER_INFO[provider]) {
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
    for (const key of ['maxToolCalls', 'maxTokens', 'maxDurationMs', 'maxParallel', 'maxRounds'] as const) {
      const val = solverRaw[key]
      if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val < 1)) {
        errors.push(`solver.${key} must be a positive number, got ${JSON.stringify(val)}`)
      }
    }
    const chainSteps = solverRaw.maxActiveChainSteps
    if (chainSteps !== undefined && (typeof chainSteps !== 'number' || !Number.isFinite(chainSteps) || chainSteps < 0)) {
      errors.push(`solver.maxActiveChainSteps must be a non-negative number, got ${JSON.stringify(chainSteps)}`)
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
      validateTierConfigValue(`modelTiers.${tier}`, modelTiers[tier], errors)
    }
  }
  if (requireCredentials && modelTiers) {
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

  const modelRolesRaw = raw.modelRoles && typeof raw.modelRoles === 'object'
    ? raw.modelRoles as Record<string, unknown>
    : undefined
  if (raw.modelRoles && typeof raw.modelRoles !== 'object') {
    errors.push('modelRoles must be an object')
  } else if (modelRolesRaw) {
    validateTierConfigValue('modelRoles.brain', modelRolesRaw.brain, errors)
    validateTierConfigValue('modelRoles.spider', modelRolesRaw.spider, errors)
    validateTierConfigValue('modelRoles.crawlSummarizer', modelRolesRaw.crawlSummarizer, errors)
    validateTierConfigValue('modelRoles.verifier', modelRolesRaw.verifier, errors)
    validateTierConfigValue('modelRoles.reporter', modelRolesRaw.reporter, errors)
    validateTierConfigValue('modelRoles.council', modelRolesRaw.council, errors)
    const workerRaw = typeof modelRolesRaw.worker === 'object' && modelRolesRaw.worker
      ? modelRolesRaw.worker as Record<string, unknown>
      : undefined
    if (modelRolesRaw.worker && typeof modelRolesRaw.worker !== 'object') {
      errors.push('modelRoles.worker must be an object')
    } else if (workerRaw) {
      for (const complexity of ['low', 'medium', 'high', 'critical'] as const) {
        validateTierConfigValue(`modelRoles.worker.${complexity}`, workerRaw[complexity], errors)
      }
    }
  }
  if (requireCredentials && modelRolesRaw) {
    const roleEntries: Array<[string, unknown]> = [
      ['modelRoles.brain', modelRolesRaw.brain],
      ['modelRoles.spider', modelRolesRaw.spider],
      ['modelRoles.crawlSummarizer', modelRolesRaw.crawlSummarizer],
      ['modelRoles.verifier', modelRolesRaw.verifier],
      ['modelRoles.reporter', modelRolesRaw.reporter],
      ['modelRoles.council', modelRolesRaw.council],
    ]
    const workerRaw = typeof modelRolesRaw.worker === 'object' && modelRolesRaw.worker
      ? modelRolesRaw.worker as Record<string, unknown>
      : undefined
    if (workerRaw) {
      for (const complexity of ['low', 'medium', 'high', 'critical'] as const) {
        roleEntries.push([`modelRoles.worker.${complexity}`, workerRaw[complexity]])
      }
    }
    for (const [path, val] of roleEntries) {
      const cfg = parseTierConfigValue(val, provider ?? 'groq')
      if (cfg?.provider && !creds[cfg.provider]) {
        errors.push(`creds.${cfg.provider} is required for ${path}`)
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
          provider: slashIdx !== -1 ? val.slice(0, slashIdx) : provider ?? 'groq',
          model: slashIdx !== -1 ? val.slice(slashIdx + 1) : val,
        }
      } else if (val && typeof val === 'object' && 'provider' in val && 'model' in val) {
        const parsed = parseTierConfigValue(val, provider ?? 'groq')
        if (parsed) parsedTiers[tier] = parsed
      }
    }
    // Only set if at least one tier exists
    if (Object.keys(parsedTiers).length === 0) parsedTiers = undefined
  }

  let parsedModelRoles: ModelRoles | undefined
  if (modelRolesRaw) {
    parsedModelRoles = {}
    const brain = parseTierConfigValue(modelRolesRaw.brain, provider ?? 'groq')
    const spider = parseTierConfigValue(modelRolesRaw.spider, provider ?? 'groq')
    const crawlSummarizer = parseTierConfigValue(modelRolesRaw.crawlSummarizer, provider ?? 'groq')
    const verifier = parseTierConfigValue(modelRolesRaw.verifier, provider ?? 'groq')
    const reporter = parseTierConfigValue(modelRolesRaw.reporter, provider ?? 'groq')
    const council = parseTierConfigValue(modelRolesRaw.council, provider ?? 'groq')
    if (brain) parsedModelRoles.brain = brain
    if (spider) parsedModelRoles.spider = spider
    if (crawlSummarizer) parsedModelRoles.crawlSummarizer = crawlSummarizer
    if (verifier) parsedModelRoles.verifier = verifier
    if (reporter) parsedModelRoles.reporter = reporter
    if (council) parsedModelRoles.council = council

    const workerRaw = typeof modelRolesRaw.worker === 'object' && modelRolesRaw.worker
      ? modelRolesRaw.worker as Record<string, unknown>
      : undefined
    if (workerRaw) {
      const worker: Partial<Record<TaskComplexity, TierConfig>> = {}
      for (const complexity of ['low', 'medium', 'high', 'critical'] as const) {
        const parsed = parseTierConfigValue(workerRaw[complexity], provider ?? 'groq')
        if (parsed) worker[complexity] = parsed
      }
      if (Object.keys(worker).length > 0) parsedModelRoles.worker = worker
    }

    if (Object.keys(parsedModelRoles).length === 0) parsedModelRoles = undefined
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
    if (spiderRaw.maxPages !== undefined && (typeof spiderRaw.maxPages !== 'number' || spiderRaw.maxPages < 1)) {
      errors.push('spider.maxPages must be a positive number')
    }
    if (spiderRaw.maxDepth !== undefined && (typeof spiderRaw.maxDepth !== 'number' || spiderRaw.maxDepth < 0)) {
      errors.push('spider.maxDepth must be a non-negative number')
    }
    if (spiderRaw.maxDurationMs !== undefined && (typeof spiderRaw.maxDurationMs !== 'number' || spiderRaw.maxDurationMs < 1)) {
      errors.push('spider.maxDurationMs must be a positive number')
    }
    if (spiderRaw.authAware !== undefined && typeof spiderRaw.authAware !== 'boolean') {
      errors.push('spider.authAware must be a boolean')
    }
    if (spiderRaw.boundaryMode !== undefined && spiderRaw.boundaryMode !== 'claim-based') {
      errors.push('spider.boundaryMode must be "claim-based"')
    }
  }

  const browserRawForValidation = raw.browser as Record<string, unknown> | undefined
  if (browserRawForValidation) {
    if (browserRawForValidation.provider !== undefined && browserRawForValidation.provider !== 'stagehand') {
      errors.push('browser.provider must be "stagehand"')
    }
    if (browserRawForValidation.sessionScope !== undefined && browserRawForValidation.sessionScope !== 'workflow') {
      errors.push('browser.sessionScope must be "workflow"')
    }
  }

  const externalToolsRaw = raw.externalTools as Record<string, unknown> | undefined
  if (externalToolsRaw) {
    if (externalToolsRaw.enabled !== undefined && typeof externalToolsRaw.enabled !== 'boolean') {
      errors.push('externalTools.enabled must be a boolean')
    }
    if (externalToolsRaw.tools !== undefined && (typeof externalToolsRaw.tools !== 'object' || externalToolsRaw.tools === null || Array.isArray(externalToolsRaw.tools))) {
      errors.push('externalTools.tools must be an object')
    } else if (externalToolsRaw.tools && typeof externalToolsRaw.tools === 'object') {
      for (const [tool, value] of Object.entries(externalToolsRaw.tools as Record<string, unknown>)) {
        if (typeof value !== 'boolean') errors.push(`externalTools.tools.${tool} must be a boolean`)
      }
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
    ...(parsedModelRoles ? { modelRoles: parsedModelRoles } : {}),
    browser: {
      provider: browserRaw.provider != null ? browserRaw.provider as BrowserConfig['provider'] : DEFAULTS.browser.provider,
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
      sessionScope: browserRaw.sessionScope != null ? browserRaw.sessionScope as BrowserConfig['sessionScope'] : DEFAULTS.browser.sessionScope,
    },
    memory: {
      lastMessages: Number(memoryRaw.lastMessages ?? DEFAULTS.memory.lastMessages),
      semanticRecall: memoryRaw.semanticRecall != null ? memoryRaw.semanticRecall as MemoryConfig['semanticRecall'] : DEFAULTS.memory.semanticRecall,
      workingMemory: Boolean(memoryRaw.workingMemory ?? DEFAULTS.memory.workingMemory),
      vector: memoryRaw.vector ? {
        enabled: Boolean((memoryRaw.vector as Record<string, unknown>).enabled ?? false),
        url: (memoryRaw.vector as Record<string, unknown>).url ? String((memoryRaw.vector as Record<string, unknown>).url) : undefined,
      } : DEFAULTS.memory.vector,
      embedder: memoryRaw.embedder ? {
        provider: String((memoryRaw.embedder as Record<string, unknown>).provider ?? ''),
        model: String((memoryRaw.embedder as Record<string, unknown>).model ?? ''),
      } : undefined,
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
      backoffStrategy: (String(rateLimitRaw.backoffStrategy ?? DEFAULTS.rateLimit.backoffStrategy) as RateLimitConfig['backoffStrategy']),
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
        ...(solverRaw.maxRounds != null ? { maxRounds: Number(solverRaw.maxRounds) } : {}),
        ...(solverRaw.maxActiveChainSteps != null ? { maxActiveChainSteps: Number(solverRaw.maxActiveChainSteps) } : {}),
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
        ...(spiderRaw.maxPages != null ? { maxPages: Number(spiderRaw.maxPages) } : {}),
        ...(spiderRaw.maxDepth != null ? { maxDepth: Number(spiderRaw.maxDepth) } : {}),
        ...(spiderRaw.maxDurationMs != null ? { maxDurationMs: Number(spiderRaw.maxDurationMs) } : {}),
        ...(spiderRaw.authAware != null ? { authAware: Boolean(spiderRaw.authAware) } : {}),
        ...(spiderRaw.boundaryMode != null ? { boundaryMode: spiderRaw.boundaryMode as SpiderConfig['boundaryMode'] } : {}),
      },
    } : {}),
    ...(externalToolsRaw ? {
      externalTools: {
        ...(externalToolsRaw.enabled != null ? { enabled: Boolean(externalToolsRaw.enabled) } : {}),
        ...(externalToolsRaw.tools ? { tools: externalToolsRaw.tools as ExternalToolsConfig['tools'] } : {}),
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
    ...(raw.compression ? { compression: raw.compression as CompressionConfig } : {}),
    ...(raw.truncation ? { truncation: raw.truncation as TruncationConfig } : {}),
    ...(raw.interaction ? { interaction: raw.interaction as InteractionConfig } : {}),
    ...(raw.context ? { context: raw.context as ContextConfig } : {}),
    ...(raw.council ? { council: raw.council as import('./council/types').CouncilConfig } : {}),
    ...(raw.credentials ? { credentials: raw.credentials as Record<string, { email: string; password: string }> } : {}),
    ...(raw.providerKeys ? { providerKeys: raw.providerKeys as Record<string, ApiKeyCreds> } : {}),
    ...(raw.oast ? { oast: raw.oast as OastConfig } : {}),
    ...(Array.isArray(raw.mcp) ? { mcp: raw.mcp as McpServerConfig[] } : {}),
    ...(Array.isArray(raw.plugins) ? { plugins: raw.plugins as PluginConfig[] } : {}),
    ...(Array.isArray(raw.skillsDirs) ? { skillsDirs: raw.skillsDirs as string[] } : {}),
    ...(raw.skills ? { skills: raw.skills as { exclude?: string[] } } : {}),
  }
}

// ─── YAML helpers ───────────────────────────────────────────────────

function legacyProvidersYamlPath(): string {
  return join(homedir(), '.config', 'ultimatrix', 'providers.yaml')
}

/** Resolve the one project config used by CLI and web, including from subdirectories. */
export function getConfigPath(startDir = process.cwd()): string {
  const explicit = process.env.ULTIMATRIX_CONFIG
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(startDir, explicit)

  let dir = resolve(startDir)
  while (true) {
    const candidate = join(dir, 'ultimatrix.yaml')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return join(resolve(startDir), 'ultimatrix.yaml')
}

/** Credential file paired with the canonical project configuration. */
export function getProvidersPath(startDir = process.cwd()): string {
  return join(dirname(getConfigPath(startDir)), 'providers.yaml')
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

function normalizeCredentials(raw: unknown): ProviderCredentials {
  const creds: ProviderCredentials = {}
  if (!raw || typeof raw !== 'object') return creds

  for (const [provider, entry] of Object.entries(raw as Record<string, unknown>)) {
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
        baseUrl: String(e.baseUrl ?? e.base_url ?? ''),
      }
    } else {
      const apiKey = String(e.apiKey ?? e.api_key ?? e.key ?? '')
      const baseUrl = String(e.baseUrl ?? e.base_url ?? e.endpoint ?? '')
      if (apiKey || baseUrl) creds[provider] = { apiKey, ...(baseUrl ? { baseUrl } : {}) }
    }
  }

  return creds
}

// ─── Load config ────────────────────────────────────────────────────

export function loadConfig(options: ConfigValidationOptions = {}): UltimatrixConfig {
  const yamlConfig = loadYamlFile(getConfigPath()) ?? {}
  const creds = normalizeCredentials(loadYamlFile(getProvidersPath()))

  // Backward compatibility for pre-migration inline aliases. Saving config
  // consolidates these entries into providers.yaml.
  const providerKeysRaw = yamlConfig.providerKeys as Record<string, { apiKey?: string; baseUrl?: string }> | undefined
  if (providerKeysRaw) {
    for (const [alias, entry] of Object.entries(providerKeysRaw)) {
      if (entry && typeof entry === 'object' && entry.apiKey) {
        creds[alias] = { apiKey: entry.apiKey, ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}) }
      }
    }
  }

  const merged: Record<string, unknown> = {
    ...yamlConfig,
    creds,
    providerKeys: undefined,
  }

  return validateConfig(merged, options)
}

/** One-time migration from the legacy global credential file. */
export function migrateLegacyCredentialsToProject(
  legacyPath = legacyProvidersYamlPath(),
): { migrated: string[]; skipped: string[]; configPath: string; providersPath: string } {
  const configPath = getConfigPath()
  const providersPath = getProvidersPath()
  const project = loadYamlFile(configPath) ?? {}
  const current = normalizeCredentials(loadYamlFile(providersPath))
  const inline = normalizeCredentials(project.creds)
  const aliases = normalizeCredentials(project.providerKeys)
  const legacy = normalizeCredentials(loadYamlFile(legacyPath))
  const migrated: string[] = []
  const skipped: string[] = []

  for (const source of [inline, aliases, legacy]) {
    for (const [provider, entry] of Object.entries(source)) {
      if (!entry) continue
      if (current[provider]) {
        if (!skipped.includes(provider)) skipped.push(provider)
        continue
      }
      current[provider] = entry
      migrated.push(provider)
    }
  }

  if (migrated.length > 0 || !existsSync(providersPath)) {
    atomicWrite(providersPath, dump(current))
  }
  if ('creds' in project || 'providerKeys' in project) {
    delete project.creds
    delete project.providerKeys
    atomicWrite(configPath, dump(project))
    resetConfigCache()
  }

  return { migrated, skipped, configPath, providersPath }
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

export function loadProvidersConfig(): ProviderCredentials {
  return normalizeCredentials(loadYamlFile(getProvidersPath()))
}

export function saveProvidersConfig(creds: ProviderCredentials): void {
  atomicWrite(getProvidersPath(), dump(creds))
  resetConfigCache()
}

export function saveProjectConfig(config: UltimatrixConfig): void {
  const path = getConfigPath()

  const output: Record<string, unknown> = {
    provider: config.provider,
    model: config.model,
    target: config.target,
    depth: config.depth,
    timeout: config.timeout,
  }

  // Engine
  if (config.engine && config.engine !== DEFAULTS.engine) {
    output.engine = config.engine
  }

  if (config.modelTiers && Object.keys(config.modelTiers).length > 0) {
    const tiers: Record<string, TierConfig> = {}
    for (const [tier, tierCfg] of Object.entries(config.modelTiers)) {
      if (tierCfg) tiers[tier] = { provider: tierCfg.provider, model: tierCfg.model, ...(tierCfg.maxOutputTokens ? { maxOutputTokens: tierCfg.maxOutputTokens } : {}) }
    }
    output.modelTiers = tiers
  }

  if (config.modelRoles && Object.keys(config.modelRoles).length > 0) {
    output.modelRoles = config.modelRoles
  }

  // Write non-default browser config
  const b = config.browser
  if (!b.headless || b.viewport.width !== 1280 || b.viewport.height !== 720 ||
      b.domSettleTimeout !== 5000 || b.env !== 'LOCAL' || !b.selfHeal || b.verbose !== 0 ||
      (b.provider ?? DEFAULTS.browser.provider) !== DEFAULTS.browser.provider ||
      (b.sessionScope ?? DEFAULTS.browser.sessionScope) !== DEFAULTS.browser.sessionScope) {
    output.browser = {
      provider: b.provider ?? DEFAULTS.browser.provider,
      headless: b.headless,
      viewport: b.viewport,
      domSettleTimeout: b.domSettleTimeout,
      env: b.env,
      selfHeal: b.selfHeal,
      verbose: b.verbose,
      sessionScope: b.sessionScope ?? DEFAULTS.browser.sessionScope,
    }
  }

  // Write non-default memory config
  const m = config.memory
  if (m.lastMessages !== 10 || m.semanticRecall !== false || m.workingMemory !== true || m.vector?.enabled || m.embedder) {
    output.memory = {
      lastMessages: m.lastMessages,
      semanticRecall: m.semanticRecall,
      workingMemory: m.workingMemory,
      ...(m.vector?.enabled ? { vector: m.vector } : {}),
      ...(m.embedder ? { embedder: m.embedder } : {}),
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
  const rateLimitIsNonDefault =
    rl.requestsPerMinute !== DEFAULTS.rateLimit.requestsPerMinute ||
    rl.maxConcurrent !== DEFAULTS.rateLimit.maxConcurrent ||
    rl.retryOnLimit !== DEFAULTS.rateLimit.retryOnLimit ||
    rl.maxRetries !== DEFAULTS.rateLimit.maxRetries ||
    rl.tokensPerMinute != null ||
    rl.backoffStrategy !== DEFAULTS.rateLimit.backoffStrategy ||
    JSON.stringify(rl.backoffSteps) !== JSON.stringify(DEFAULTS.rateLimit.backoffSteps) ||
    rl.baseBackoffMs !== DEFAULTS.rateLimit.baseBackoffMs ||
    rl.maxBackoffMs !== DEFAULTS.rateLimit.maxBackoffMs ||
    rl.useHeaders !== DEFAULTS.rateLimit.useHeaders ||
    rl.headerMapping != null
  if (rateLimitIsNonDefault) {
    output.rateLimit = {
      requestsPerMinute: rl.requestsPerMinute,
      ...(rl.tokensPerMinute != null ? { tokensPerMinute: rl.tokensPerMinute } : {}),
      maxConcurrent: rl.maxConcurrent,
      retryOnLimit: rl.retryOnLimit,
      maxRetries: rl.maxRetries,
      backoffStrategy: rl.backoffStrategy,
      backoffSteps: rl.backoffSteps,
      baseBackoffMs: rl.baseBackoffMs,
      maxBackoffMs: rl.maxBackoffMs,
      useHeaders: rl.useHeaders,
      ...(rl.headerMapping ? { headerMapping: rl.headerMapping } : {}),
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

  // Write requireCapableModel if set
  if (config.requireCapableModel !== undefined) {
    output.requireCapableModel = config.requireCapableModel
  }

  // Write authorization if set
  if (config.authorization) {
    output.authorization = config.authorization
  }

  // Write solver if set
  if (config.solver) {
    output.solver = config.solver
  }

  // Write spider if set
  if (config.spider) {
    output.spider = config.spider
  }

  if (config.externalTools) {
    output.externalTools = config.externalTools
  }

  // Write antiLoop if set
  if (config.antiLoop) {
    output.antiLoop = config.antiLoop
  }

  // Write reflexion if set
  if (config.reflexion) {
    output.reflexion = config.reflexion
  }

  // Write verifier if set
  if (config.verifier) {
    output.verifier = config.verifier
  }

  // Write interaction if set
  if (config.interaction) {
    output.interaction = config.interaction
  }

  // Write campaign if set
  if (config.campaign) {
    output.campaign = config.campaign
  }

  // Write oast if set
  if (config.oast) {
    output.oast = config.oast
  }

  // Write compression if set
  if (config.compression) {
    output.compression = config.compression
  }

  // Write truncation if set
  if (config.truncation) {
    output.truncation = config.truncation
  }

  // Write council if set
  if (config.council) {
    output.council = config.council
  }

  // Write context if set
  if (config.context) {
    output.context = config.context
  }

  // Write MCP servers if set
  if (config.mcp && config.mcp.length > 0) {
    output.mcp = config.mcp
  }

  // Write plugins if set
  if (config.plugins && config.plugins.length > 0) {
    output.plugins = config.plugins
  }

  // Write skillsDirs if set
  if (config.skillsDirs && config.skillsDirs.length > 0) {
    output.skillsDirs = config.skillsDirs
  }

  // Write skills config if set
  if (config.skills) {
    output.skills = config.skills
  }

  if (config.credentials) {
    output.credentials = config.credentials
  }

  atomicWrite(path, dump(output))
}


