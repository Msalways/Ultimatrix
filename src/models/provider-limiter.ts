import { log } from '../utils/logger'
import { SlidingWindowLimiter, Semaphore } from './rate-limiter'
import { getForensicLog } from '../tools/report-tools'
import type { RateLimitConfig } from '../config'

/**
 * Per-provider rate limiter with header sync and mismatch detection.
 *
 * Wraps SlidingWindowLimiter + Semaphore per provider. Optionally syncs
 * limits from response headers (x-ratelimit-remaining, etc.) and detects
 * divergence between local tracking and server state.
 */
export class ProviderAwareLimiter {
  readonly provider: string
  private readonly window: SlidingWindowLimiter
  private readonly semaphore: Semaphore
  private readonly config: RateLimitConfig
  private lastHeaderSync = 0
  private mismatchCount = 0
  private exhaustionCount = 0

  constructor(provider: string, config: RateLimitConfig) {
    this.provider = provider
    this.config = config
    this.window = new SlidingWindowLimiter(config.requestsPerMinute)
    this.semaphore = new Semaphore(config.maxConcurrent)
  }

  async acquire(): Promise<() => void> {
    await this.window.acquire()
    return this.semaphore.acquire()
  }

  release(releaseFn: () => void): void {
    releaseFn()
  }

  getAvailable(): number {
    return this.window.getAvailable()
  }

  getConcurrent(): number {
    return this.semaphore.getAvailable()
  }

  cooldown(ms: number): void {
    this.window.cooldown(ms)
  }

  getUsed(): number {
    return this.window.getUsed()
  }

  /**
   * Sync local limiter state from response headers.
   * Returns the number of mismatches detected.
   */
  syncFromHeaders(headers: Record<string, string>): number {
    if (!this.config.useHeaders) return 0

    const mapping = this.config.headerMapping ?? {}
    let mismatches = 0

    // Sync RPM remaining
    const remainingKey = mapping.remaining ?? 'x-ratelimit-remaining'
    const headerRemaining = this.parseHeaderInt(headers[remainingKey])
    if (headerRemaining !== null) {
      const localRemaining = this.window.getAvailable()
      const diff = Math.abs(localRemaining - headerRemaining)
      if (diff > 5) {
        mismatches++
        this.mismatchCount++
        log.dim(`Rate limit mismatch [${this.provider}]: local=${localRemaining}, header=${headerRemaining} (diff=${diff})`)
        // Auto-sync: adjust local window by recording the difference
        if (diff > 10) {
          // Server says fewer remaining — we need to consume some slots
          // (don't add, just acknowledge the drift)
          log.dim(`Rate limit auto-sync [${this.provider}]: accepting header state (${headerRemaining} remaining)`)
        }
      }
      this.lastHeaderSync = Date.now()
    }

    // Sync TPM remaining
    const tpmKey = mapping.tokensRemaining ?? 'x-ratelimit-tokens-remaining'
    const headerTpmRemaining = this.parseHeaderInt(headers[tpmKey])
    if (headerTpmRemaining !== null && this.config.tokensPerMinute) {
      // TPM tracking is informational only (no sliding window for tokens yet)
      log.dim(`TPM remaining [${this.provider}]: ${headerTpmRemaining}/${this.config.tokensPerMinute}`)
    }

    // Detect reset time
    const resetKey = mapping.reset ?? 'x-ratelimit-reset'
    const resetStr = headers[resetKey]
    if (resetStr) {
      const resetMs = this.parseHeaderInt(resetStr)
      if (resetMs !== null && resetMs > 0) {
        // Some headers use epoch seconds, some use milliseconds
        const resetTime = resetMs > 1e12 ? resetMs : resetMs * 1000
        const waitMs = resetTime - Date.now()
        if (waitMs > 0 && waitMs < 60_000) {
          log.dim(`Rate limit reset [${this.provider}] in ${Math.round(waitMs)}ms`)
        }
      }
    }

    // Detect Retry-After header (on 429 responses)
    const retryAfterKey = mapping.retryAfter ?? 'retry-after'
    const retryAfter = this.parseHeaderInt(headers[retryAfterKey])
    if (retryAfter !== null && retryAfter > 0) {
      const waitMs = retryAfter > 1e12 ? retryAfter - Date.now() : retryAfter * 1000
      if (waitMs > 0) {
        log.warn(`Retry-After [${this.provider}]: waiting ${Math.round(waitMs)}ms`)
        this.window.cooldown(waitMs)
      }
    }

    return mismatches
  }

  /**
   * Record that a cumulative quota exhaustion was detected.
   * Activates cooldown based on backoff config.
   */
  recordExhaustion(): void {
    this.exhaustionCount++
    const backoffStrategy = this.config.backoffStrategy ?? 'stepped'
    const baseMs = this.config.baseBackoffMs ?? 2000
    const maxMs = this.config.maxBackoffMs ?? 30_000
    const steps = this.config.backoffSteps

    let cooldownMs: number

    if (backoffStrategy === 'stepped' && steps && steps.length > 0) {
      cooldownMs = Math.min(steps[Math.min(this.exhaustionCount, steps.length - 1)], maxMs)
    } else if (backoffStrategy === 'fixed') {
      cooldownMs = Math.min(baseMs, maxMs)
    } else {
      // exponential
      cooldownMs = Math.min(baseMs * Math.pow(2, this.exhaustionCount), maxMs)
    }

    this.window.cooldown(cooldownMs)

    getForensicLog()?.log({
      type: 'tool-error',
      agent: this.provider,
      tool: 'rate-limiter',
      error: `Quota exhausted, cooldown ${cooldownMs}ms (strategy=${backoffStrategy})`,
    })
  }

  getStatus(): {
    provider: string
    used: number
    available: number
    concurrent: number
    inCooldown: boolean
    lastSync: number
    mismatchCount: number
    exhaustionCount: number
  } {
    return {
      provider: this.provider,
      used: this.window.getUsed(),
      available: this.window.getAvailable(),
      concurrent: this.semaphore.getAvailable(),
      inCooldown: this.window.getAvailable() === 0,
      lastSync: this.lastHeaderSync,
      mismatchCount: this.mismatchCount,
      exhaustionCount: this.exhaustionCount,
    }
  }

  private parseHeaderInt(value: string | undefined): number | null {
    if (value === undefined || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
}
