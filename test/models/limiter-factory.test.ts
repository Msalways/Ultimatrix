import { describe, it, expect, beforeEach } from 'vitest'
import { createProviderLimiter, getProviderFromModelId, resetAllProviderLimiters, getLimiterCacheSize } from '../../src/models/limiter-factory'
import type { UltimatrixConfig } from '../../src/config'

function makeConfig(overrides?: Partial<UltimatrixConfig>): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    depth: 2,
    timeout: 60000,
    creds: { groq: { apiKey: 'gsk_xxx' } },
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    ...overrides,
  }
}

describe('getProviderFromModelId', () => {
  it('extracts provider from provider/model format', () => {
    expect(getProviderFromModelId('groq/llama3-8b-8192')).toBe('groq')
    expect(getProviderFromModelId('openai/gpt-4o')).toBe('openai')
    expect(getProviderFromModelId('anthropic/claude-3-5-sonnet')).toBe('anthropic')
  })

  it('returns unknown for bare model id', () => {
    expect(getProviderFromModelId('gpt-4o')).toBe('unknown')
  })
})

describe('createProviderLimiter', () => {
  beforeEach(() => {
    resetAllProviderLimiters()
  })

  it('creates a limiter for a provider', () => {
    const limiter = createProviderLimiter('groq', makeConfig())
    expect(limiter.provider).toBe('groq')
    expect(limiter.getAvailable()).toBe(60)
  })

  it('caches limiter per provider', () => {
    const a = createProviderLimiter('groq', makeConfig())
    const b = createProviderLimiter('groq', makeConfig())
    expect(a).toBe(b)
    expect(getLimiterCacheSize()).toBe(1)
  })

  it('different providers get different limiters', () => {
    createProviderLimiter('groq', makeConfig())
    createProviderLimiter('openai', makeConfig())
    expect(getLimiterCacheSize()).toBe(2)
  })

  it('uses providerRateLimits when available', () => {
    const config = makeConfig({
      providerRateLimits: {
        groq: { requestsPerMinute: 30, maxConcurrent: 2, retryOnLimit: true, maxRetries: 5 },
      },
    })
    const limiter = createProviderLimiter('groq', config)
    expect(limiter.getAvailable()).toBe(30)
  })

  it('falls back to global rateLimit', () => {
    const config = makeConfig({
      rateLimit: { requestsPerMinute: 120, maxConcurrent: 5, retryOnLimit: true, maxRetries: 3 },
    })
    const limiter = createProviderLimiter('nvidia', config)
    expect(limiter.getAvailable()).toBe(120)
  })

  it('resetAllProviderLimiters clears cache', () => {
    createProviderLimiter('groq', makeConfig())
    expect(getLimiterCacheSize()).toBe(1)
    resetAllProviderLimiters()
    expect(getLimiterCacheSize()).toBe(0)
  })
})
