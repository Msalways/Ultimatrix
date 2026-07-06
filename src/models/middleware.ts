import type { LanguageModelV2 } from '@ai-sdk/provider'
import type { UltimatrixConfig } from '../config'
import { DEFAULTS } from '../config'
import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'
import { getGlobalUsageTracker } from '../usage/tracker'
import { createProviderLimiter, getProviderFromModelId } from './limiter-factory'
import { getGlobalQuotaTracker } from './quota-tracker'

function isRateLimitError(err: any): boolean {
  const msg = String(err?.message || err || '')
  const status = err?.status || err?.statusCode
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('ResourceExhausted') ||
    msg.includes('rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('request limit') ||
    msg.includes('Too Many Requests')
  )
}

function isCumulativeQuotaExhausted(err: any): boolean {
  const msg = String(err?.message || err || '')
  return /\(\d+\/\d+\)/.test(msg)
}

/**
 * Wraps a LanguageModelV2 with per-provider rate limiting, concurrency control,
 * retry with configurable backoff, header sync, and forensic logging.
 *
 * Each model gets its own ProviderAwareLimiter based on its provider.
 * Falls back to shared singletons when providerRateLimits is not configured.
 */
export function wrapModel(model: LanguageModelV2, config: UltimatrixConfig): LanguageModelV2 {
  const rl = config.rateLimit ?? { requestsPerMinute: DEFAULTS.rateLimit.requestsPerMinute, maxConcurrent: DEFAULTS.rateLimit.maxConcurrent, retryOnLimit: DEFAULTS.rateLimit.retryOnLimit, maxRetries: DEFAULTS.rateLimit.maxRetries, backoffStrategy: DEFAULTS.rateLimit.backoffStrategy, backoffSteps: DEFAULTS.rateLimit.backoffSteps, baseBackoffMs: DEFAULTS.rateLimit.baseBackoffMs, maxBackoffMs: DEFAULTS.rateLimit.maxBackoffMs, useHeaders: DEFAULTS.rateLimit.useHeaders }

  if (rl.requestsPerMinute <= 0) {
    return model
  }

  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop !== 'doStream' && prop !== 'doGenerate') {
        return Reflect.get(target, prop, receiver)
      }

      const originalMethod = Reflect.get(target, prop, receiver) as Function

      return async function (this: any, args: any) {
        // Resolve provider from model ID or target modelId
        const modelIdStr = args?.model || args?.modelId || (target as any).modelId || 'unknown'
        const provider = getProviderFromModelId(String(modelIdStr))

        // Get per-provider limiter
        const providerLimiter = createProviderLimiter(provider, config)

        // Acquire both window slot and concurrency permit
        const releaseSemaphore = await providerLimiter.acquire()
        try {
          const start = performance.now()
          let lastError: any = null
          const attempts = rl.retryOnLimit ? rl.maxRetries + 1 : 1

          for (let attempt = 0; attempt < attempts; attempt++) {
            try {
              const result = await originalMethod.call(target, args)

              const duration = Math.round(performance.now() - start)
              getForensicLog()?.log({
                type: 'tool-result',
                agent: provider,
                tool: String(prop),
                duration,
              })

              // Sync from response headers if available
              if (result?.headers && typeof result.headers === 'object') {
                providerLimiter.syncFromHeaders(result.headers)
              }

              // Record request in quota tracker
              getGlobalQuotaTracker().recordRequest(provider)

              // Capture token usage from doGenerate responses
              if (prop === 'doGenerate' && result?.usage) {
                const usage = result.usage
                const inputTokens = usage.inputTokens ?? 0
                const outputTokens = usage.outputTokens ?? 0
                if (inputTokens > 0 || outputTokens > 0) {
                  const [prov = 'unknown', model = 'unknown'] = String(modelIdStr).split('/')
                  getGlobalUsageTracker().record(prov, model, inputTokens, outputTokens)
                }
              }

              return result
            } catch (err: any) {
              lastError = err

              // Rate limit or cumulative quota — retry with provider-specific backoff
              if ((isRateLimitError(err) || isCumulativeQuotaExhausted(err)) && attempt < attempts - 1) {
                const backoffMs = computeBackoff(attempt, rl)
                const label = isCumulativeQuotaExhausted(err) ? 'Quota exhausted' : 'Rate limited'
                log.warn(`${label} [${provider}], retry ${attempt + 1}/${rl.maxRetries} in ${backoffMs}ms`)
                await new Promise(r => setTimeout(r, backoffMs))
                continue
              }

              // Cumulative quota — activate cooldown for provider
              if (isCumulativeQuotaExhausted(err)) {
                providerLimiter.recordExhaustion()
                getGlobalQuotaTracker().recordExhaustion(provider)
              }

              const duration = Math.round(performance.now() - start)
              getForensicLog()?.log({
                type: 'tool-error',
                agent: provider,
                tool: String(prop),
                error: err?.message || String(err),
                duration,
              })

              throw err
            }
          }

          throw lastError
        } finally {
          releaseSemaphore()
        }
      }
    },
  }) as LanguageModelV2
}

function computeBackoff(attempt: number, rl: { backoffStrategy?: string; backoffSteps?: number[]; baseBackoffMs?: number; maxBackoffMs?: number }): number {
  const strategy = rl.backoffStrategy ?? 'stepped'
  const baseMs = rl.baseBackoffMs ?? 2000
  const maxMs = rl.maxBackoffMs ?? 30_000

  if (strategy === 'stepped' && rl.backoffSteps && rl.backoffSteps.length > 0) {
    return Math.min(rl.backoffSteps[Math.min(attempt, rl.backoffSteps.length - 1)], maxMs)
  }
  if (strategy === 'fixed') {
    return Math.min(baseMs, maxMs)
  }
  // exponential
  return Math.min(baseMs * Math.pow(2, attempt), maxMs)
}
