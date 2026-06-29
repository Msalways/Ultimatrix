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
  maxConcurrent: number
  retryOnLimit: boolean
  maxRetries: number
}

export interface ModelTiers {
  fast?: string
  balanced?: string
  powerful?: string
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

export type EngineType = 'legacy' | 'solver'

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
  engine?: EngineType
  solver?: SolverConfig
  antiLoop?: AntiLoopConfig
  reflexion?: ReflexionConfig
}

// ─── Dynamic memory sizing based on model context window ─────────────

const CONTEXT_WINDOW_MAP: Record<string, number> = {
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

  // Validate engine
  const engine = raw.engine as EngineType | undefined
  if (engine !== undefined && engine !== 'legacy' && engine !== 'solver') {
    errors.push(`engine must be "legacy" or "solver", got "${engine}"`)
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
  const modelTiers = raw.modelTiers as ModelTiers | undefined
  if (modelTiers) {
    for (const tier of ['fast', 'balanced', 'powerful'] as const) {
      const tierModel = modelTiers[tier]
      if (tierModel && typeof tierModel === 'string') {
        const tierProvider = tierModel.includes('/') ? tierModel.split('/')[0] : provider
        if (tierProvider && !creds[tierProvider]) {
          errors.push(`creds.${tierProvider} is required for modelTiers.${tier} = "${tierModel}"`)
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(`Config validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`)
  }

  // Store modelTiers as-is — no parsing, no stripping
  let parsedTiers: ModelTiers | undefined
  if (modelTiers) {
    parsedTiers = {}
    for (const tier of ['fast', 'balanced', 'powerful'] as const) {
      const val = modelTiers[tier]
      if (val && typeof val === 'string') {
        parsedTiers[tier] = val
      }
    }
    // Only set if at least one tier exists
    if (Object.keys(parsedTiers).length === 0) parsedTiers = undefined
  }

  // Build config with user-provided or sensible values for non-LLM fields
  const depth = raw.depth != null ? Number(raw.depth) : 2
  const timeout = raw.timeout != null ? Number(raw.timeout) : 60000
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
      headless: browserRaw.headless != null ? Boolean(browserRaw.headless) : true,
      viewport: {
        width: Number(browserRaw.viewport && typeof browserRaw.viewport === 'object'
          ? (browserRaw.viewport as Record<string, unknown>).width ?? 1280 : 1280),
        height: Number(browserRaw.viewport && typeof browserRaw.viewport === 'object'
          ? (browserRaw.viewport as Record<string, unknown>).height ?? 720 : 720),
      },
      domSettleTimeout: Number(browserRaw.domSettleTimeout ?? 5000),
      env: String(browserRaw.env ?? 'LOCAL'),
      selfHeal: browserRaw.selfHeal != null ? Boolean(browserRaw.selfHeal) : true,
      verbose: Number(browserRaw.verbose ?? 0),
    },
    memory: {
      lastMessages: Number(memoryRaw.lastMessages ?? 10),
      semanticRecall: Boolean(memoryRaw.semanticRecall ?? false),
      workingMemory: Boolean(memoryRaw.workingMemory ?? true),
    },
    agent: {
      maxSteps: Number(agentRaw.maxSteps ?? 50),
      scansDir: String(agentRaw.scansDir ?? './scans'),
    },
    rateLimit: {
      requestsPerMinute: Number(rateLimitRaw.requestsPerMinute ?? 60),
      maxConcurrent: Number(rateLimitRaw.maxConcurrent ?? 3),
      retryOnLimit: rateLimitRaw.retryOnLimit != null ? Boolean(rateLimitRaw.retryOnLimit) : true,
      maxRetries: Number(rateLimitRaw.maxRetries ?? 3),
    },
    engine: (engine as EngineType) || 'solver',
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
    // Write tiers with provider prefix for clarity
    const tiers: Record<string, string> = {}
    for (const [tier, modelId] of Object.entries(config.modelTiers)) {
      if (modelId) tiers[tier] = modelId
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
  if (a.maxSteps !== 50 || a.scansDir !== './scans') {
    output.agent = {
      maxSteps: a.maxSteps,
      scansDir: a.scansDir,
    }
  }

  // Write non-default rate limit config
  const rl = config.rateLimit
  if (rl.requestsPerMinute !== 60 || rl.maxConcurrent !== 3 || rl.retryOnLimit !== true || rl.maxRetries !== 3) {
    output.rateLimit = {
      requestsPerMinute: rl.requestsPerMinute,
      maxConcurrent: rl.maxConcurrent,
      retryOnLimit: rl.retryOnLimit,
      maxRetries: rl.maxRetries,
    }
  }

  writeFileSync(path, dump(output), 'utf-8')
}


