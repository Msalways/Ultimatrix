import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { load, dump } from 'js-yaml'

export interface UltimatrixConfig {
  model: string
  target?: string
  depth: number
  headless: boolean
  provider: string
  modelId: string
  baseUrl?: string
}

const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  togethercomputer: 'TOGETHER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  bedrock: 'AWS_ACCESS_KEY_ID',
  azure: 'AZURE_API_KEY',
}

function parseModelString(model: string): { provider: string; modelId: string } {
  const slashIdx = model.indexOf('/')
  if (slashIdx === -1) return { provider: 'openai', modelId: model }
  return { provider: model.slice(0, slashIdx), modelId: model.slice(slashIdx + 1) }
}

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

function resolveApiKey(provider: string, providersYaml: Record<string, unknown> | null): string | undefined {
  const envVar = PROVIDER_ENV_MAP[provider]
  const fromEnv = envVar ? process.env[envVar] : undefined
  if (fromEnv) return fromEnv

  if (providersYaml) {
    const providerEntry = providersYaml[provider]
    if (providerEntry && typeof providerEntry === 'object') {
      const entry = providerEntry as Record<string, unknown>
      const key = entry.apiKey || entry.api_key || entry.key
      if (typeof key === 'string') return key
    }
  }
  return undefined
}

function resolveBaseUrl(provider: string, providersYaml: Record<string, unknown> | null): string | undefined {
  if (providersYaml) {
    const providerEntry = providersYaml[provider]
    if (providerEntry && typeof providerEntry === 'object') {
      const entry = providerEntry as Record<string, unknown>
      if (typeof entry.baseUrl === 'string') return entry.baseUrl
      if (typeof entry.base_url === 'string') return entry.base_url
      if (typeof entry.endpoint === 'string') return entry.endpoint
    }
  }
  return undefined
}

export function saveProvidersConfig(data: Record<string, unknown>): void {
  const path = providersYamlPath()
  const dir = path.substring(0, path.lastIndexOf('\\'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, dump(data), 'utf-8')
}

export function saveProjectConfig(data: Record<string, unknown>): void {
  const path = ultimatrixYamlPath()
  writeFileSync(path, dump(data), 'utf-8')
}

export function loadConfig(): UltimatrixConfig {
  const ultimatrixYaml = loadYamlFile(ultimatrixYamlPath()) || {}
  const providersYaml = loadYamlFile(providersYamlPath())

  const model = process.env.LLM_MODEL || (ultimatrixYaml.model as string) || 'openai/gpt-4o'
  const { provider, modelId } = parseModelString(model)

  const apiKey = resolveApiKey(provider, providersYaml)
  if (apiKey) {
    const envVar = PROVIDER_ENV_MAP[provider] || `${provider.toUpperCase()}_API_KEY`
    if (!process.env[envVar]) {
      process.env[envVar] = apiKey
    }
  }

  const baseUrl = resolveBaseUrl(provider, providersYaml)

  return {
    model,
    provider,
    modelId,
    baseUrl,
    target: process.env.TARGET || (ultimatrixYaml.target as string) || undefined,
    depth: Number(process.env.DEPTH || ultimatrixYaml.depth || 2),
    headless: (process.env.HEADLESS || String(ultimatrixYaml.headless ?? 'true')) !== 'false',
  }
}
