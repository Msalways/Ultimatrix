import type { McpServerConfig, ModelCapability, ModelModuleRole, ModelTierName, TaskComplexity, UltimatrixConfig } from '../config'
import { resolveProviderAlias } from '../config'
import { COMPLEXITY_TIER_MAP, DEFAULT_MODULE_TIERS, fullModelId, resolveModelRef } from './routing'

export type EffectiveStatus = 'ok' | 'warning' | 'error'

export interface EffectiveModelRoute {
  provider: string
  model: string
  modelId: string
  capability?: ModelCapability
  credentialConfigured: boolean
  reason: string
}

export interface EffectiveTier extends EffectiveModelRoute {
  tier: ModelTierName
}

export interface EffectiveModuleRoute extends EffectiveModelRoute {
  role: ModelModuleRole
  tier: ModelTierName
  advancedOverride: boolean
}

export interface EffectiveWorkerRoute extends EffectiveModelRoute {
  complexity: TaskComplexity
  tier: ModelTierName
  advancedOverride: boolean
}

export interface EffectiveMcpServer {
  name: string
  type: 'stdio' | 'http' | 'sse'
  location: string
  trusted: boolean
  auth?: string
  status: EffectiveStatus
  warnings: string[]
}

export interface EffectiveConfig {
  status: EffectiveStatus
  defaultModel: EffectiveModelRoute
  tiers: Record<ModelTierName, EffectiveTier>
  modules: Record<ModelModuleRole, EffectiveModuleRoute>
  workers: Record<TaskComplexity, EffectiveWorkerRoute>
  mcp: EffectiveMcpServer[]
  warnings: string[]
  errors: string[]
}

const TIERS: ModelTierName[] = ['fast', 'balanced', 'powerful']
const MODULES: ModelModuleRole[] = ['brain', 'spider', 'crawlSummarizer', 'verifier', 'reporter', 'council']
const COMPLEXITIES: TaskComplexity[] = ['low', 'medium', 'high', 'critical']

function capabilityFor(config: UltimatrixConfig, provider: string, model: string): ModelCapability | undefined {
  const id = fullModelId(provider, model)
  return config.modelCapabilities?.[id] ?? config.modelCapabilities?.[model]
}

function hasCred(config: UltimatrixConfig, provider: string): boolean {
  const base = resolveProviderAlias(provider)
  return Boolean(config.creds?.[provider] || config.creds?.[base])
}

function route(config: UltimatrixConfig, provider: string, model: string, reason: string): EffectiveModelRoute {
  return {
    provider,
    model,
    modelId: fullModelId(provider, model),
    capability: capabilityFor(config, provider, model),
    credentialConfigured: hasCred(config, provider),
    reason,
  }
}

function mcpStatus(server: McpServerConfig): EffectiveMcpServer {
  const type = server.type ?? (server.url ? 'http' : 'stdio')
  const location = server.command ?? server.url ?? ''
  const warnings: string[] = []
  if (!location) warnings.push('missing command/url')
  if (!server.trusted) warnings.push('untrusted')
  return {
    name: server.name,
    type,
    location,
    trusted: Boolean(server.trusted),
    auth: server.auth?.kind,
    status: warnings.length ? 'warning' : 'ok',
    warnings,
  }
}

export function resolveEffectiveConfig(config: UltimatrixConfig): EffectiveConfig {
  const warnings: string[] = []
  const errors: string[] = []
  const defaultModel = route(config, config.provider, config.model, 'default config model')

  const tiers = Object.fromEntries(TIERS.map((tier) => {
    const cfg = config.modelTiers?.[tier] ?? { provider: config.provider, model: config.model }
    return [tier, { tier, ...route(config, cfg.provider, cfg.model, config.modelTiers?.[tier] ? `configured modelTiers.${tier}` : 'fallback default model') }]
  })) as Record<ModelTierName, EffectiveTier>

  const modules = Object.fromEntries(MODULES.map((role) => {
    const resolved = resolveModelRef(config, { role })
    const tier = (config.modelRoleTiers?.[role] ?? DEFAULT_MODULE_TIERS[role]) as ModelTierName
    return [role, {
      role,
      tier: resolved.tier as ModelTierName,
      advancedOverride: Boolean(config.modelRoles?.[role]),
      ...route(config, resolved.provider, resolved.model, config.modelRoles?.[role] ? resolved.reason : `module tier ${role}->${tier}`),
    }]
  })) as Record<ModelModuleRole, EffectiveModuleRoute>

  const workers = Object.fromEntries(COMPLEXITIES.map((complexity) => {
    const resolved = resolveModelRef(config, { role: 'worker', complexity })
    return [complexity, {
      complexity,
      tier: COMPLEXITY_TIER_MAP[complexity],
      advancedOverride: Boolean(config.modelRoles?.worker?.[complexity]),
      ...route(config, resolved.provider, resolved.model, resolved.reason),
    }]
  })) as Record<TaskComplexity, EffectiveWorkerRoute>

  for (const tier of TIERS) {
    const t = tiers[tier]
    if (!config.modelTiers?.[tier]) warnings.push(`modelTiers.${tier} is not configured; using default model`)
    if (!t.credentialConfigured) errors.push(`credentials missing for tier ${tier}: ${t.provider}`)
    if (!t.capability) warnings.push(`modelCapabilities missing for ${t.modelId}`)
  }

  if (!defaultModel.credentialConfigured) errors.push(`credentials missing for default provider: ${defaultModel.provider}`)
  const mcp = (config.mcp ?? []).map(mcpStatus)
  for (const server of mcp) {
    for (const warning of server.warnings) warnings.push(`mcp.${server.name}: ${warning}`)
  }

  const status: EffectiveStatus = errors.length ? 'error' : warnings.length ? 'warning' : 'ok'
  return { status, defaultModel, tiers, modules, workers, mcp, warnings, errors }
}
