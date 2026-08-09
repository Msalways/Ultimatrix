import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dump, load } from 'js-yaml'
import { PROVIDER_INFO, DEFAULTS, getConfigPath, getProvidersPath, validateConfig } from '../config'
import type { EngineType } from '../config'

// ─── Types ─────────────────────────────────────────────────────────

export interface SetupInput {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  engine?: EngineType
  modelTiers?: Record<string, { provider: string; model: string }>
  crossProviderKeys?: Record<string, { apiKey: string; baseUrl?: string }>
}

export interface SetupResult {
  ok: boolean
  errors?: string[]
  configPath?: string
  providersPath?: string
}

// ─── Connection test ───────────────────────────────────────────────

export async function testProviderConnection(
  baseUrl: string,
  model: string,
  apiKey: string,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  try {
    const t0 = Date.now()
    const res = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `${res.status} ${body.slice(0, 100)}` }
    }
    return { ok: true, latencyMs: Date.now() - t0 }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Shared setup logic ────────────────────────────────────────────

export async function runSetup(input: SetupInput): Promise<SetupResult> {
  const errors: string[] = []

  const providerInfo = PROVIDER_INFO[input.provider]
  if (!providerInfo) {
    errors.push(`Unknown provider: ${input.provider}`)
    return { ok: false, errors }
  }
  if (!input.model?.trim()) {
    errors.push('Model name is required')
    return { ok: false, errors }
  }
  if (!input.apiKey?.trim()) {
    errors.push('API key is required')
    return { ok: false, errors }
  }

  const projectPath = getConfigPath()
  const providersPath = getProvidersPath()
  const engine: EngineType = input.engine ?? 'solver'

  // ── Build project config ──
  let projectData: Record<string, unknown> = {}
  if (existsSync(projectPath)) {
    try {
      const existing = load(readFileSync(projectPath, 'utf-8'))
      if (existing && typeof existing === 'object') projectData = existing as Record<string, unknown>
    } catch { /* ignore */ }
  }

  projectData.engine = engine
  projectData.provider = input.provider
  projectData.model = input.model

  if (input.modelTiers && Object.keys(input.modelTiers).length > 0) {
    projectData.modelTiers = input.modelTiers
  }

  // ── Build credentials ──
  let credentials: Record<string, unknown> = {}
  if (existsSync(providersPath)) {
    try {
      const existing = load(readFileSync(providersPath, 'utf-8'))
      if (existing && typeof existing === 'object') credentials = existing as Record<string, unknown>
    } catch { /* ignore */ }
  }

  credentials[input.provider] = {
    apiKey: input.apiKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
  }

  // Cross-provider keys for multi-model tiers
  if (input.crossProviderKeys) {
    for (const [providerId, providerCreds] of Object.entries(input.crossProviderKeys)) {
      credentials[providerId] = {
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseUrl: providerCreds.baseUrl } : {}),
      }
    }
  }

  // Clean legacy fields
  delete projectData.creds
  delete projectData.providerKeys

  // Apply defaults if not set
  if (!projectData.browser) {
    projectData.browser = {
      headless: true,
      viewport: { width: 1280, height: 720 },
      domSettleTimeout: 5000,
      env: 'LOCAL',
      selfHeal: true,
      verbose: 0,
    }
  }
  if (!projectData.memory) {
    projectData.memory = {
      lastMessages: 10,
      semanticRecall: false,
      workingMemory: true,
    }
  }
  if (!projectData.agent) {
    projectData.agent = {
      maxSteps: DEFAULTS.agent.maxSteps,
      scansDir: DEFAULTS.agent.scansDir,
    }
  }

  // ── Write files ──
  try {
    writeFileSync(providersPath, dump(credentials), 'utf-8')
  } catch (e) {
    errors.push(`Failed to write providers.yaml: ${(e as Error).message}`)
  }

  try {
    writeFileSync(projectPath, dump(projectData), 'utf-8')
  } catch (e) {
    errors.push(`Failed to write ultimatrix.yaml: ${(e as Error).message}`)
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    configPath: projectPath,
    providersPath,
  }
}
