import type { LanguageModelV2 } from '@ai-sdk/provider'
import type { UltimatrixConfig } from '../config'
import { getSharedBucket, getSharedSemaphore } from './rate-limiter'
import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'

function isRateLimitError(err: any): boolean {
  const msg = String(err?.message || err || '')
  const status = err?.status || err?.statusCode
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('ResourceExhausted') ||
    msg.includes('rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('Too Many Requests')
  )
}

function isCumulativeQuotaExhausted(err: any): boolean {
  const msg = String(err?.message || err || '')
  return /\(\d+\/\d+\)/.test(msg) && msg.includes('ResourceExhausted')
}

/**
  * Wraps a LanguageModelV2 with rate limiting, concurrency control,
  * retry with backoff, and forensic logging.
  *
  * Every model in the system goes through this — spider, workers, supervisor.
  * All share the same token bucket + semaphore instances.
  */
export function wrapModel(model: LanguageModelV2, config: UltimatrixConfig): LanguageModelV2 {
  const rl = config.rateLimit ?? { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 }

  if (rl.requestsPerMinute <= 0) {
    return model
  }

  const bucket = getSharedBucket(rl.requestsPerMinute)
  const semaphore = getSharedSemaphore(rl.maxConcurrent)

  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop !== 'doStream' && prop !== 'doGenerate') {
        return Reflect.get(target, prop, receiver)
      }

      const originalMethod = Reflect.get(target, prop, receiver) as Function

        return async function (this: any, args: any) {
        const release = await semaphore.acquire()
        try {
          await bucket.acquire()

          const start = performance.now()
          let lastError: any = null
          const attempts = rl.retryOnLimit ? rl.maxRetries + 1 : 1

          for (let attempt = 0; attempt < attempts; attempt++) {
            try {
              const result = await originalMethod.call(target, args)

              const duration = Math.round(performance.now() - start)
              getForensicLog()?.log({
                type: 'tool-result',
                agent: 'model',
                tool: String(prop),
                duration,
              })

              return result
            } catch (err: any) {
              lastError = err

              // Cumulative quota exhaustion — don't retry (wastes more requests)
              if (isCumulativeQuotaExhausted(err)) {
                log.warn('API quota exhausted — cumulative limit reached. Do not retry.')
                const duration = Math.round(performance.now() - start)
                getForensicLog()?.log({
                  type: 'tool-error',
                  agent: 'model',
                  tool: String(prop),
                  error: `Cumulative quota exhausted: ${err?.message || String(err)}`,
                  duration,
                })
                throw err
              }

              if (isRateLimitError(err) && attempt < attempts - 1) {
                const backoffMs = 1000 * Math.pow(2, attempt)
                log.warn(`Rate limited, retry ${attempt + 1}/${rl.maxRetries} in ${backoffMs}ms`)
                await new Promise(r => setTimeout(r, backoffMs))
                continue
              }

              const duration = Math.round(performance.now() - start)
              getForensicLog()?.log({
                type: 'tool-error',
                agent: 'model',
                tool: String(prop),
                error: err?.message || String(err),
                duration,
              })

              throw err
            }
          }

          throw lastError
        } finally {
          release()
        }
      }
    },
  }) as LanguageModelV2
}
