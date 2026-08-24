import type { UltimatrixConfig } from '../config'
import { DEFAULTS } from '../config'
import { ProviderAwareLimiter } from './provider-limiter'
import { getEngagementServices } from '../runtime/engagement-context'

/**
 * Factory for creating and caching per-provider rate limiters.
 *
 * Each provider gets exactly one ProviderAwareLimiter per engagement.
 * Config lookup: config.providerRateLimits[provider] → config.rateLimit → DEFAULTS
 */
const legacyLimiterCache = new Map<string, ProviderAwareLimiter>()

function getLimiterCache(): Map<string, ProviderAwareLimiter> {
  return getEngagementServices()?.providerLimiters ?? legacyLimiterCache
}

export function createProviderLimiter(provider: string, config: UltimatrixConfig): ProviderAwareLimiter {
  const limiterCache = getLimiterCache()
  const cached = limiterCache.get(provider)
  if (cached) return cached

  const rl = config.providerRateLimits?.[provider] ?? config.rateLimit ?? {
    requestsPerMinute: DEFAULTS.rateLimit.requestsPerMinute,
    maxConcurrent: DEFAULTS.rateLimit.maxConcurrent,
    retryOnLimit: DEFAULTS.rateLimit.retryOnLimit,
    maxRetries: DEFAULTS.rateLimit.maxRetries,
  }

  const limiter = new ProviderAwareLimiter(provider, rl)
  limiterCache.set(provider, limiter)
  return limiter
}

export function getProviderFromModelId(modelId: string): string {
  const parts = modelId.split('/')
  return parts.length > 1 ? parts[0] : 'unknown'
}

export function resetAllProviderLimiters(): void {
  getLimiterCache().clear()
}

export function getLimiterCacheSize(): number {
  return getLimiterCache().size
}
