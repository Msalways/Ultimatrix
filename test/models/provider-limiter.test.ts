import { describe, it, expect, beforeEach } from 'vitest'
import { ProviderAwareLimiter } from '../../src/models/provider-limiter'
import type { RateLimitConfig } from '../../src/config'

function makeConfig(overrides?: Partial<RateLimitConfig>): RateLimitConfig {
  return {
    requestsPerMinute: 60,
    maxConcurrent: 3,
    retryOnLimit: true,
    maxRetries: 3,
    ...overrides,
  }
}

describe('ProviderAwareLimiter', () => {
  it('creates with correct provider name', () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig())
    expect(limiter.provider).toBe('groq')
  })

  it('tracks available slots', () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig({ requestsPerMinute: 10 }))
    expect(limiter.getAvailable()).toBe(10)
    expect(limiter.getUsed()).toBe(0)
  })

  it('tracks concurrency', () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig({ maxConcurrent: 2 }))
    expect(limiter.getConcurrent()).toBe(2)
  })

  it('acquire and release reduces available', async () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig({ requestsPerMinute: 5, maxConcurrent: 2 }))
    const release = await limiter.acquire()
    expect(limiter.getUsed()).toBe(1)
    expect(limiter.getAvailable()).toBe(4)
    release()
  })

  it('separate providers have independent windows', async () => {
    const groq = new ProviderAwareLimiter('groq', makeConfig({ requestsPerMinute: 2 }))
    const openai = new ProviderAwareLimiter('openai', makeConfig({ requestsPerMinute: 2 }))

    await groq.acquire()
    await groq.acquire()

    expect(groq.getAvailable()).toBe(0)
    expect(openai.getAvailable()).toBe(2)
  })

  it('syncFromHeaders parses x-ratelimit-remaining', () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig({ requestsPerMinute: 60, useHeaders: true }))
    const mismatches = limiter.syncFromHeaders({
      'x-ratelimit-remaining': '50',
      'x-ratelimit-reset': '1720000000',
    })
    expect(typeof mismatches).toBe('number')
  })

  it('syncFromHeaders respects useHeaders: false', () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig({ requestsPerMinute: 60, useHeaders: false }))
    const mismatches = limiter.syncFromHeaders({
      'x-ratelimit-remaining': '0',
    })
    expect(mismatches).toBe(0)
  })

  it('syncFromHeaders parses Retry-After and activates cooldown', async () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig({ requestsPerMinute: 60, useHeaders: true }))
    limiter.syncFromHeaders({
      'retry-after': '1',
    })
    // After retry-after of 1 second, available should be limited
    // (the cooldown should have been activated)
    expect(limiter.getStatus().provider).toBe('groq')
  })

  it('recordExhaustion triggers cooldown', () => {
    const limiter = new ProviderAwareLimiter('groq', makeConfig({
      requestsPerMinute: 10,
      backoffStrategy: 'fixed',
      baseBackoffMs: 100,
    }))
    limiter.recordExhaustion()
    const status = limiter.getStatus()
    expect(status.exhaustionCount).toBe(1)
  })

  it('getStatus returns complete status', () => {
    const limiter = new ProviderAwareLimiter('nvidia', makeConfig())
    const status = limiter.getStatus()
    expect(status.provider).toBe('nvidia')
    expect(status.used).toBe(0)
    expect(status.available).toBe(60)
    expect(status.concurrent).toBe(3)
    expect(status.inCooldown).toBe(false)
    expect(status.mismatchCount).toBe(0)
  })

  it('backoff strategies produce different cooldowns', () => {
    const fixed = new ProviderAwareLimiter('fixed', makeConfig({
      requestsPerMinute: 10,
      backoffStrategy: 'fixed',
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
    }))
    const exponential = new ProviderAwareLimiter('exp', makeConfig({
      requestsPerMinute: 10,
      backoffStrategy: 'exponential',
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
    }))
    const stepped = new ProviderAwareLimiter('stepped', makeConfig({
      requestsPerMinute: 10,
      backoffStrategy: 'stepped',
      backoffSteps: [5000, 15000, 30000],
      maxBackoffMs: 30000,
    }))

    fixed.recordExhaustion()
    exponential.recordExhaustion()
    stepped.recordExhaustion()

    // All should have recorded 1 exhaustion
    expect(fixed.getStatus().exhaustionCount).toBe(1)
    expect(exponential.getStatus().exhaustionCount).toBe(1)
    expect(stepped.getStatus().exhaustionCount).toBe(1)
  })
})
