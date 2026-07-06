import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QuotaTracker, getGlobalQuotaTracker, resetGlobalQuotaTracker } from '../../src/models/quota-tracker'
import { ProviderAwareLimiter } from '../../src/models/provider-limiter'
import type { RateLimitConfig } from '../../src/config'

beforeEach(() => {
  resetGlobalQuotaTracker()
})

afterEach(() => {
  resetGlobalQuotaTracker()
})

describe('Integration: Rate Limit Fallback', () => {
  it('exhaustion triggers cooldown', () => {
    const tracker = getGlobalQuotaTracker()
    tracker.recordExhaustion('groq', 5000)

    expect(tracker.isExhausted('groq')).toBe(true)
    expect(tracker.isExhausted('openai')).toBe(false)
  })

  it('cooldown auto-clears after expiry', () => {
    const tracker = getGlobalQuotaTracker()
    tracker.recordExhaustion('groq', 1) // 1ms cooldown

    expect(tracker.isExhausted('groq')).toBe(true)

    return new Promise(resolve => setTimeout(() => {
      expect(tracker.isExhausted('groq')).toBe(false)
      resolve(undefined)
    }, 5))
  })

  it('provider limiter tracks RPM via acquire/release', async () => {
    const config: RateLimitConfig = {
      requestsPerMinute: 5,
      maxConcurrent: 2,
      retryOnLimit: false,
    }

    const limiter = new ProviderAwareLimiter('groq', config)

    // Acquire 2 concurrent slots (within both RPM and concurrency)
    const release1 = await limiter.acquire()
    const release2 = await limiter.acquire()

    expect(limiter.getUsed()).toBeGreaterThanOrEqual(2)

    release1()
    release2()
  })

  it('provider limiter tracks usage', async () => {
    const config: RateLimitConfig = {
      requestsPerMinute: 10,
      maxConcurrent: 1,
      retryOnLimit: false,
    }

    const limiter = new ProviderAwareLimiter('groq', config)

    const release = await limiter.acquire()
    expect(limiter.getUsed()).toBeGreaterThanOrEqual(1)
    release()
  })

  it('provider limiter getStatus returns valid state', () => {
    const config: RateLimitConfig = {
      requestsPerMinute: 10,
      maxConcurrent: 1,
      retryOnLimit: false,
    }

    const limiter = new ProviderAwareLimiter('groq', config)
    const status = limiter.getStatus()

    expect(status.provider).toBe('groq')
    expect(typeof status.used).toBe('number')
    expect(typeof status.available).toBe('number')
    expect(typeof status.mismatchCount).toBe('number')
  })

  it('syncFromHeaders detects mismatches when useHeaders is true', () => {
    const config: RateLimitConfig = {
      requestsPerMinute: 10,
      maxConcurrent: 1,
      retryOnLimit: false,
      useHeaders: true,
    }

    const limiter = new ProviderAwareLimiter('groq', config)
    const mismatches = limiter.syncFromHeaders({
      'x-ratelimit-remaining': '50',
    })

    expect(typeof mismatches).toBe('number')
    const status = limiter.getStatus()
    expect(status.lastSync).toBeGreaterThan(0)
  })

  it('syncFromHeaders returns 0 when useHeaders is false', () => {
    const config: RateLimitConfig = {
      requestsPerMinute: 10,
      maxConcurrent: 1,
      retryOnLimit: false,
      useHeaders: false,
    }

    const limiter = new ProviderAwareLimiter('groq', config)
    const mismatches = limiter.syncFromHeaders({
      'x-ratelimit-remaining': '50',
    })

    expect(mismatches).toBe(0)
  })

  it('per-provider tracking isolates providers', () => {
    const tracker = getGlobalQuotaTracker()
    tracker.recordRequest('groq')
    tracker.recordRequest('groq')
    tracker.recordRequest('openai')

    const status = tracker.getStatus()
    expect(status.groq?.used).toBe(2)
    expect(status.openai?.used).toBe(1)
  })
})
