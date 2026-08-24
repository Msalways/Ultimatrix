import type { ModelModuleRole, ModelTierName, TaskComplexity, TierConfig, UltimatrixConfig } from '../config'

export type ModelRole = 'brain' | 'worker' | 'spider' | 'crawlSummarizer' | 'verifier' | 'reporter' | 'council'
export type ModelTier = 'fast' | 'balanced' | 'powerful' | 'default'
export type { TaskComplexity }
export type StableModelRole = ModelModuleRole

export const COMPLEXITY_TIER_MAP: Record<TaskComplexity, Exclude<ModelTier, 'default'>> = {
  low: 'fast',
  medium: 'balanced',
  high: 'powerful',
  critical: 'powerful',
}

export const DEFAULT_MODULE_TIERS: Record<StableModelRole, ModelTierName> = {
  brain: 'balanced',
  spider: 'fast',
  crawlSummarizer: 'fast',
  verifier: 'balanced',
  reporter: 'balanced',
  council: 'powerful',
}

export interface ModelRouteOptions {
  role?: ModelRole
  complexity?: TaskComplexity
  tier?: ModelTier | string
  modelId?: string
}

export interface ResolvedModelRef {
  provider: string
  model: string
  modelId: string
  tier: Exclude<ModelTier, 'default'> | string
  maxOutputTokens?: number
  reason: string
}

export function splitModelId(modelId: string, fallbackProvider: string): { provider: string; model: string } {
  const slashIdx = modelId.indexOf('/')
  if (slashIdx === -1) return { provider: fallbackProvider, model: modelId }
  return { provider: modelId.slice(0, slashIdx), model: modelId.slice(slashIdx + 1) }
}

export function fullModelId(provider: string, model: string): string {
  return model.includes('/') ? model : `${provider}/${model}`
}

function tierFromOptions(config: UltimatrixConfig, options: ModelRouteOptions): TierConfig | undefined {
  const requestedTier = options.tier === 'default' || !options.tier ? undefined : options.tier
  if (requestedTier) return config.modelTiers?.[requestedTier as keyof typeof config.modelTiers]
  if (options.role && options.role !== 'worker') {
    const tier = config.modelRoleTiers?.[options.role] ?? DEFAULT_MODULE_TIERS[options.role]
    return config.modelTiers?.[tier]
  }
  if (options.role === 'worker' && options.complexity) return config.modelTiers?.[COMPLEXITY_TIER_MAP[options.complexity]]
  return config.modelTiers?.balanced
}

function tierNameForOptions(config: UltimatrixConfig, options: ModelRouteOptions): Exclude<ModelTier, 'default'> | string {
  if (options.role === 'worker' && options.complexity) return COMPLEXITY_TIER_MAP[options.complexity]
  if (options.role && options.role !== 'worker') return config.modelRoleTiers?.[options.role] ?? DEFAULT_MODULE_TIERS[options.role]
  return options.tier === 'default' || !options.tier ? 'balanced' : options.tier
}

export function resolveModelRef(config: UltimatrixConfig, options: ModelRouteOptions = {}): ResolvedModelRef {
  if (options.modelId) {
    const explicit = splitModelId(options.modelId, config.provider)
    return {
      provider: explicit.provider,
      model: explicit.model,
      modelId: options.modelId,
      tier: options.tier === 'default' || !options.tier ? 'balanced' : options.tier,
      maxOutputTokens: findMaxOutputTokens(config, explicit.provider, explicit.model),
      reason: 'explicit modelId override',
    }
  }

  let cfg: TierConfig | undefined
  let reason = 'default config model'

  if (options.role === 'brain' && config.modelRoles?.brain) {
    cfg = config.modelRoles.brain
    reason = 'configured modelRoles.brain'
  } else if (options.role === 'spider' && config.modelRoles?.spider) {
    cfg = config.modelRoles.spider
    reason = 'configured modelRoles.spider'
  } else if (options.role === 'crawlSummarizer' && config.modelRoles?.crawlSummarizer) {
    cfg = config.modelRoles.crawlSummarizer
    reason = 'configured modelRoles.crawlSummarizer'
  } else if (options.role === 'verifier' && config.modelRoles?.verifier) {
    cfg = config.modelRoles.verifier
    reason = 'configured modelRoles.verifier'
  } else if (options.role === 'reporter' && config.modelRoles?.reporter) {
    cfg = config.modelRoles.reporter
    reason = 'configured modelRoles.reporter'
  } else if (options.role === 'council' && config.modelRoles?.council) {
    cfg = config.modelRoles.council
    reason = 'configured modelRoles.council'
  } else if (options.role === 'worker' && options.complexity && config.modelRoles?.worker?.[options.complexity]) {
    cfg = config.modelRoles.worker[options.complexity]
    reason = `configured modelRoles.worker.${options.complexity}`
  } else {
    cfg = tierFromOptions(config, options)
    if (cfg) {
      const tier = tierNameForOptions(config, options)
      reason = `configured modelTiers.${tier}`
    }
  }

  const provider = cfg?.provider ?? config.provider
  const model = cfg?.model ?? config.model
  const tier = tierNameForOptions(config, options)

  return {
    provider,
    model,
    modelId: fullModelId(provider, model),
    tier,
    maxOutputTokens: findMaxOutputTokens(config, provider, model),
    reason,
  }
}

export function findMaxOutputTokens(config: UltimatrixConfig, provider: string, model: string): number | undefined {
  const modelId = fullModelId(provider, model)
  return config.modelCapabilities?.[modelId]?.maxOutputTokens
    ?? config.modelCapabilities?.[model]?.maxOutputTokens
}
