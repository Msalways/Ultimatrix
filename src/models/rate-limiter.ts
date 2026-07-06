import { log } from '../utils/logger'

/**
 * Sliding Window Rate Limiter.
 *
 * Tracks timestamps of actual API calls in a rolling window.
 * When the count within the window reaches the limit, callers block
 * until the oldest call falls outside the window.
 *
 * Unlike a token bucket, this enforces the EXACT rolling window
 * that API providers use (e.g. NVIDIA's 32/minute). No burst,
 * no double-counting, no leaky bucket artifacts.
 *
 * Shared across all agents — one instance per process.
 */
export class SlidingWindowLimiter {
  private readonly windowMs: number
  private readonly maxRequests: number
  private timestamps: number[] = []
  private globalCooldownUntil = 0

  constructor(requestsPerMinute: number, windowMs = 60_000) {
    this.maxRequests = requestsPerMinute
    this.windowMs = windowMs
  }

  async acquire(): Promise<void> {
    // Global cooldown — activated on cumulative quota exhaustion
    if (this.globalCooldownUntil > 0) {
      const waitMs = this.globalCooldownUntil - Date.now()
      if (waitMs > 0) {
        log.dim(`Rate limit: global cooldown active, waiting ${waitMs}ms`)
        await new Promise(r => setTimeout(r, waitMs))
      }
      this.globalCooldownUntil = 0
    }

    // Evict timestamps outside the rolling window
    const now = Date.now()
    const windowStart = now - this.windowMs
    this.timestamps = this.timestamps.filter(t => t > windowStart)

    // If at capacity, wait until the oldest timestamp expires
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0]
      const waitMs = oldest + this.windowMs - now + 1
      if (waitMs > 0) {
        log.dim(`Rate limit: waiting ${waitMs}ms for window slot (${this.timestamps.length}/${this.maxRequests})`)
        await new Promise(r => setTimeout(r, waitMs))
      }
      // Evict expired timestamps after waiting
      const newNow = Date.now()
      const newWindowStart = newNow - this.windowMs
      this.timestamps = this.timestamps.filter(t => t > newWindowStart)
    }

    this.timestamps.push(Date.now())
  }

  /**
   * Pause all callers for `durationMs`. Triggered on cumulative quota
   * exhaustion (e.g. NVIDIA's hard per-minute limit).
   */
  cooldown(durationMs: number): void {
    this.globalCooldownUntil = Date.now() + durationMs
    log.warn(`Rate limit: global cooldown for ${durationMs}ms (quota exhausted)`)
  }

  /**
   * How many calls are in the current window.
   */
  getUsed(): number {
    const now = Date.now()
    const windowStart = now - this.windowMs
    this.timestamps = this.timestamps.filter(t => t > windowStart)
    return this.timestamps.length
  }

  /**
   * How many calls are still available in the current window.
   */
  getAvailable(): number {
    return Math.max(0, this.maxRequests - this.getUsed())
  }

  /**
   * Wait until at least `minSlots` are available in the window.
   * Used for inter-phase cooldowns (e.g. spider → solver transition).
   */
  async waitForCapacity(minSlots: number = 5, maxWaitMs: number = 30_000): Promise<void> {
    const start = Date.now()
    while (this.getAvailable() < minSlots && Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 500))
    }
    if (this.getAvailable() < minSlots) {
      log.dim(`Rate limit: waitForCapacity timed out (${this.getAvailable()}/${minSlots} available after ${maxWaitMs}ms)`)
    }
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

let _sharedLimiter: SlidingWindowLimiter | null = null
let _sharedSemaphore: Semaphore | null = null

export function getSharedLimiter(requestsPerMinute: number): SlidingWindowLimiter {
  if (!_sharedLimiter) {
    _sharedLimiter = new SlidingWindowLimiter(requestsPerMinute)
  }
  return _sharedLimiter
}

export function getSharedSemaphore(maxConcurrent: number): Semaphore {
  if (!_sharedSemaphore) {
    _sharedSemaphore = new Semaphore(maxConcurrent)
  }
  return _sharedSemaphore
}

export function resetSharedInstances(): void {
  _sharedLimiter = null
  _sharedSemaphore = null
}

// ─── Backward compat (legacy name) ─────────────────────────────────

/**
 * @deprecated Use getSharedLimiter instead.
 */
export function getSharedBucket(requestsPerMinute: number): SlidingWindowLimiter {
  return getSharedLimiter(requestsPerMinute)
}
