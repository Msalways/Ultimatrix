import type { LanguageModelV2 } from '@ai-sdk/provider'
import type { UltimatrixConfig } from '../config'
import { DEFAULTS, PROVIDER_INFO, resolveProviderAlias } from '../config'
import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'
import { getGlobalUsageTracker } from '../usage/tracker'
import { createProviderLimiter, getProviderFromModelId } from './limiter-factory'
import { getGlobalQuotaTracker } from './quota-tracker'
import { ContextWindowRegistry } from './context-window-registry'
import { withOverflowRecovery } from './overflow-handler'

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

function isAuthError(err: any): boolean {
  const msg = String(err?.message || err || '')
  const status = err?.status || err?.statusCode
  return (
    status === 401 ||
    status === 403 ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('Unauthorized') ||
    msg.includes('authentication') ||
    msg.includes('invalid_api_key') ||
    msg.includes('API key')
  )
}

function isCumulativeQuotaExhausted(err: any): boolean {
  const msg = String(err?.message || err || '')
  return /\(\d+\/\d+\)/.test(msg)
}

/**
 * Enforce OpenAI-compatible message ordering: a `user` or `system` message may
 * not immediately follow a `tool` message. Strict providers (NVIDIA NIM, Mistral)
 * reject `role: 'user' after role: 'tool'` with HTTP 400, while others tolerate
 * it. Insert a minimal non-empty assistant placeholder so every tool result is
 * "consumed" before any subsequent user/system message. This is purely a
 * transport-compat shim — it does not change the agent's reasoning.
 */
function sanitizeMessageOrdering(messages: any[]): any[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages
  const out: any[] = []
  for (let i = 0; i < messages.length; i++) {
    const cur = messages[i]
    out.push(cur)
    const next = messages[i + 1]
    if (cur?.role === 'tool' && next && (next.role === 'user' || next.role === 'system')) {
      out.push({ role: 'assistant', content: [{ type: 'text', text: '[tool results processed]' }] })
    }
  }
  return out
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

      const originalMethod = Reflect.get(target, prop, receiver) as (...args: unknown[]) => Promise<unknown>

      return async function (this: any, args: any) {
        // Enforce OpenAI-compatible message ordering before sending to the API
        // (NVIDIA/Mistral reject `user` after `tool` with HTTP 400).
        if (args && Array.isArray(args.messages)) {
          const sanitized = sanitizeMessageOrdering(args.messages)
          if (sanitized !== args.messages) args = { ...args, messages: sanitized }
        }

        // Resolve provider from model ID or target modelId
        const modelIdStr = args?.model || args?.modelId || (target as any).modelId || 'unknown'
        const provider = getProviderFromModelId(String(modelIdStr))

        // Overflow recovery: wraps the entire call (including semaphore + rate-limit retry)
        // so that compaction + retry re-enters the full call chain.
        const registry = new ContextWindowRegistry(config)

        return withOverflowRecovery(
          async (compactedArgs) => {
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
                  const result = await originalMethod.call(target, compactedArgs)

                  const duration = Math.round(performance.now() - start)
                  getForensicLog()?.log({
                    type: 'tool-result',
                    agent: provider,
                    tool: String(prop),
                    duration,
                  })

                  // Sync from response headers if available
                  if ((result as any)?.headers && typeof (result as any).headers === 'object') {
                    providerLimiter.syncFromHeaders((result as any).headers)
                  }

                  // Record request in quota tracker
                  getGlobalQuotaTracker().recordRequest(provider)

                  // Capture token usage from doGenerate responses
                  let inputTokens = 0
                  let outputTokens = 0
                  if (prop === 'doGenerate' && (result as any)?.usage) {
                    inputTokens = (result as any).usage.inputTokens ?? 0
                    outputTokens = (result as any).usage.outputTokens ?? 0
                    if (inputTokens > 0 || outputTokens > 0) {
                      const [prov = 'unknown', model = 'unknown'] = String(modelIdStr).split('/')
                      getGlobalUsageTracker().record(prov, model, inputTokens, outputTokens)
                    }
                  }

                  // Forensic model-call: record which model actually served the request
                  // so every dispatched task is attributable to a concrete modelId/tier.
                  getForensicLog()?.log({
                    type: 'model-call',
                    agent: provider,
                    tool: String(prop),
                    duration,
                    metadata: {
                      provider,
                      modelId: String(modelIdStr),
                      inputTokens,
                      outputTokens,
                      totalTokens: inputTokens + outputTokens,
                    },
                  })

                  return result
                } catch (err: any) {
                  lastError = err

                  // Auth errors (401/403) — do NOT retry, surface immediately
                  if (isAuthError(err)) {
                    const duration = Math.round(performance.now() - start)
                    getForensicLog()?.log({
                      type: 'tool-error',
                      agent: provider,
                      tool: String(prop),
                      error: `Auth failure [${provider}]: ${err?.message || String(err)}`,
                      duration,
                    })
                    throw new Error(
                      `Authentication failed for ${provider}: ${err?.message || String(err)}. ` +
                      `Check your API key for ${provider} in providers.yaml or set ${PROVIDER_INFO[resolveProviderAlias(provider)]?.envVar ?? 'the provider env var'}.`
                    )
                  }

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
          },
          args,
          String(modelIdStr),
          registry,
          config,
        )
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
