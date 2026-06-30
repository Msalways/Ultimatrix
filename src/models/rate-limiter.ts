import { log } from '../utils/logger'

/**
 * Token Bucket rate limiter.
 *
 * Refills tokens at a constant rate (1 token per refillIntervalMs).
 * Callers block via acquire() when no tokens are available.
 * Shared across all agents — one instance per process.
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillPerMs: number

  constructor(requestsPerMinute: number) {
    this.maxTokens = requestsPerMinute
    this.tokens = requestsPerMinute
    this.refillPerMs = requestsPerMinute / 60_000
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens < 1) {
      const now = Date.now()
      const msUntilNextToken = Math.ceil((1 - this.tokens) / this.refillPerMs)
      log.dim(`Rate limit: waiting ${msUntilNextToken}ms for token`)
      await new Promise(r => setTimeout(r, msUntilNextToken))
      this.refill()
    }

    this.tokens = Math.max(0, this.tokens - 1)
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed <= 0) return
    const newTokens = elapsed * this.refillPerMs
    if (newTokens >= 1) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens)
      this.lastRefill = now
    }
  }

  getAvailable(): number {
    this.refill()
    return Math.floor(this.tokens)
  }
}

/**
 * Semaphore — limits concurrent in-flight operations.
 * Prevents resource waste when many callers compete for rate limit tokens.
 */
export class Semaphore {
  private permits: number
  private queue: Array<() => void> = []

  constructor(maxConcurrent: number) {
    this.permits = maxConcurrent
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--
      return () => this.release()
    }

    await new Promise<void>(resolve => {
      this.queue.push(resolve)
    })
    return () => this.release()
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next()
    } else {
      this.permits++
    }
  }

  getWaiting(): number {
    return this.queue.length
  }

  getAvailable(): number {
    return this.permits
  }
}

// ─── Shared singletons ─────────────────────────────────────────────

let _sharedBucket: TokenBucket | null = null
let _sharedSemaphore: Semaphore | null = null

export function getSharedBucket(requestsPerMinute: number): TokenBucket {
  if (!_sharedBucket) {
    _sharedBucket = new TokenBucket(requestsPerMinute)
  }
  return _sharedBucket
}

export function getSharedSemaphore(maxConcurrent: number): Semaphore {
  if (!_sharedSemaphore) {
    _sharedSemaphore = new Semaphore(maxConcurrent)
  }
  return _sharedSemaphore
}

export function resetSharedInstances(): void {
  _sharedBucket = null
  _sharedSemaphore = null
}
