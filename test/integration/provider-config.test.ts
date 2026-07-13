import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateConfig, resolveProviderAlias, DEFAULTS, type UltimatrixConfig } from '../../src/config'
import { ModelSelector } from '../../src/models/selector'
import { ProviderAwareLimiter } from '../../src/models/provider-limiter'
import { resetAllProviderLimiters, getLimiterCacheSize } from '../../src/models/limiter-factory'

// ─── Scenario A: Single model, no tiers ─────────────────────────

describe('Scenario A: Single model, no tiers', () => {
  it('validateConfig passes and returns all fields with defaults', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
    })

    expect(config.provider).toBe('groq')
    expect(config.model).toBe('llama3-8b-8192')
    expect(config.engine).toBe('multi-model')

    // budgetPolicy should be DEFAULTS (not undefined!)
    expect(config.budgetPolicy).toBeDefined()
    expect(config.budgetPolicy!.enforcement).toBe('soft')
    expect(config.budgetPolicy!.allocation).toEqual({ brain: 0.3, workers: 0.6, spider: 0.1 })
    expect(config.budgetPolicy!.maxModelCallsPerTask).toBe(15)

    // modelCapabilities should be undefined (not provided)
    expect(config.modelCapabilities).toBeUndefined()

    // providerRateLimits should be undefined (not provided)
    expect(config.providerRateLimits).toBeUndefined()

    // verifier should use DEFAULTS
    expect(config.verifier).toEqual(DEFAULTS.verifier)
  })

  it('ModelSelector works with no capabilities (graceful fallback)', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
    })

    // Should not crash with undefined capabilities or budgetPolicy
    const selector = new ModelSelector(undefined, undefined, config)
    const result = selector.selectForTask(
      { skillId: 'recon', taskDescription: 'test', complexity: 'medium' },
      'worker',
    )

    expect(result.provider).toBe('groq')
    expect(result.modelId).toBe('llama3-8b-8192')
    expect(result.reasoning).toContain('Fallback')
  })
})

// ─── Scenario B: Multi-provider with tiers ──────────────────────

describe('Scenario B: Multi-provider with tiers', () => {
  it('validateConfig passes with cross-provider tiers and creds', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: {
        groq: { apiKey: 'gsk_test' },
        openai: { apiKey: 'sk_test' },
      },
      modelTiers: {
        fast: 'groq/llama3-8b-8192',
        powerful: 'openai/gpt-4o',
      },
    })

    expect(config.modelTiers?.fast).toEqual({ provider: 'groq', model: 'llama3-8b-8192' })
    expect(config.modelTiers?.powerful).toEqual({ provider: 'openai', model: 'gpt-4o' })
  })

  it('validateConfig rejects tier with missing creds', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
      modelTiers: {
        powerful: 'openai/gpt-4o',
      },
    })).toThrow('creds.openai is required')
  })

  it('ModelSelector picks tier models from multi-provider capabilities', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: {
        groq: { apiKey: 'gsk_test' },
        openai: { apiKey: 'sk_test' },
      },
      modelCapabilities: {
        'groq/llama3-8b-8192': {
          contextWindow: 8192,
          maxOutputTokens: 4096,
          strengths: ['fast-inference'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
        },
        'openai/gpt-4o': {
          contextWindow: 128000,
          maxOutputTokens: 16384,
          strengths: ['reasoning', 'vision'],
          supportsStreaming: true,
          supportsStructuredOutput: true,
        },
      },
    })

    const selector = new ModelSelector(config.modelCapabilities, config.budgetPolicy, config)

    // High complexity should pick openai/gpt-4o
    const result = selector.selectForTask(
      { skillId: 'vuln-discovery', taskDescription: 'deep analysis', complexity: 'critical' },
      'worker',
    )

    expect(result.provider).toBe('openai')
    expect(result.modelId).toBe('openai/gpt-4o')
  })
})

// ─── Scenario C: Custom budget policy ───────────────────────────

describe('Scenario C: Custom budget policy', () => {
  it('validateConfig returns custom budgetPolicy', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
      budgetPolicy: {
        enforcement: 'hard',
        scope: 'turn',
        resetOn: 'turn',
        allocation: { brain: 0.5, workers: 0.4, spider: 0.1 },
        maxModelCallsPerTask: 30,
        trackTokens: true,
      },
    })

    expect(config.budgetPolicy).toBeDefined()
    expect(config.budgetPolicy!.enforcement).toBe('hard')
    expect(config.budgetPolicy!.scope).toBe('turn')
    expect(config.budgetPolicy!.resetOn).toBe('turn')
    expect(config.budgetPolicy!.allocation).toEqual({ brain: 0.5, workers: 0.4, spider: 0.1 })
    expect(config.budgetPolicy!.maxModelCallsPerTask).toBe(30)
    expect(config.budgetPolicy!.trackTokens).toBe(true)
  })

  it('validateConfig returns providerRateLimits', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
      providerRateLimits: {
        groq: { requestsPerMinute: 30, tokensPerMinute: 100000, maxConcurrent: 3, retryOnLimit: true, maxRetries: 5 },
        openai: { requestsPerMinute: 60, maxConcurrent: 5, retryOnLimit: true, maxRetries: 3 },
      },
    })

    expect(config.providerRateLimits).toBeDefined()
    expect(config.providerRateLimits!.groq.requestsPerMinute).toBe(30)
    expect(config.providerRateLimits!.groq.tokensPerMinute).toBe(100000)
    expect(config.providerRateLimits!.openai.requestsPerMinute).toBe(60)
  })

  it('validateConfig returns spider config', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
      spider: { maxSteps: 50, maxDurationMs: 120000 },
    })

    expect(config.spider).toBeDefined()
    expect(config.spider!.maxSteps).toBe(50)
    expect(config.spider!.maxDurationMs).toBe(120000)
  })

  it('validateConfig returns modelCapabilities', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
      modelCapabilities: {
        'groq/llama3-8b-8192': {
          contextWindow: 8192,
          maxOutputTokens: 4096,
          strengths: ['fast'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
        },
      },
    })

    expect(config.modelCapabilities).toBeDefined()
    expect(config.modelCapabilities!['groq/llama3-8b-8192'].contextWindow).toBe(8192)
  })
})

// ─── Scenario D: Provider alias resolution ──────────────────────

describe('Scenario D: Provider alias resolution', () => {
  it('resolveProviderAlias resolves known provider', () => {
    expect(resolveProviderAlias('groq')).toBe('groq')
    expect(resolveProviderAlias('openai')).toBe('openai')
    expect(resolveProviderAlias('anthropic')).toBe('anthropic')
  })

  it('resolveProviderAlias resolves alias with dash', () => {
    expect(resolveProviderAlias('groq-free')).toBe('groq')
    expect(resolveProviderAlias('openai-preview')).toBe('openai')
    expect(resolveProviderAlias('anthropic-temp')).toBe('anthropic')
  })

  it('resolveProviderAlias returns unknown as-is', () => {
    expect(resolveProviderAlias('custom-provider')).toBe('custom-provider')
    expect(resolveProviderAlias('myllm')).toBe('myllm')
  })
})

// ─── Model keys without / prefix ────────────────────────────────

describe('Model keys without / prefix', () => {
  it('ModelSelector handles capabilities without provider prefix', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_test' } },
      modelCapabilities: {
        'llama3-8b-8192': {
          contextWindow: 8192,
          maxOutputTokens: 4096,
          strengths: ['fast-inference'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
        },
      },
    })

    const selector = new ModelSelector(config.modelCapabilities, config.budgetPolicy, config)
    const result = selector.selectForTask(
      { skillId: 'recon', taskDescription: 'quick scan', complexity: 'low' },
      'worker',
    )

    // Should find the model (prefixed with primary provider)
    expect(result.provider).toBe('groq')
    expect(result.modelId).toBe('groq/llama3-8b-8192')
  })
})

// ─── Exhaustion bug fix ─────────────────────────────────────────

describe('Exhaustion bug fix', () => {
  it('recordExhaustion increments exhaustionCount (not mismatchCount)', () => {
    const limiter = new ProviderAwareLimiter('test', {
      requestsPerMinute: 10,
      maxConcurrent: 2,
      retryOnLimit: true,
      maxRetries: 3,
      backoffStrategy: 'stepped',
      backoffSteps: [1000, 2000, 4000, 8000],
    })

    limiter.recordExhaustion()
    limiter.recordExhaustion()

    const status = limiter.getStatus()
    expect(status.exhaustionCount).toBe(2)
    // mismatchCount should remain 0 (not incremented by exhaustion)
    expect(status.mismatchCount).toBe(0)
  })
})

// ─── Limiter cache clearing ─────────────────────────────────────

describe('Limiter cache clearing', () => {
  beforeEach(() => {
    resetAllProviderLimiters()
  })

  it('resetAllProviderLimiters clears the cache', () => {
    expect(getLimiterCacheSize()).toBe(0)
  })
})

// ─── Full config round-trip ─────────────────────────────────────

describe('Full config round-trip', () => {
  it('all optional fields survive validateConfig round-trip', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      target: 'https://example.com',
      creds: { groq: { apiKey: 'gsk_test' } },
      engine: 'solver',
      budgetPolicy: {
        enforcement: 'hard',
        scope: 'turn',
        resetOn: 'turn',
        allocation: { brain: 0.4, workers: 0.5, spider: 0.1 },
        maxModelCallsPerTask: 20,
        trackTokens: true,
      },
      providerRateLimits: {
        groq: { requestsPerMinute: 30, maxConcurrent: 3, retryOnLimit: true, maxRetries: 5 },
      },
      modelCapabilities: {
        'groq/llama3-8b-8192': {
          contextWindow: 8192,
          maxOutputTokens: 4096,
          strengths: ['fast'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
        },
      },
      spider: { maxSteps: 30, maxDurationMs: 60000 },
      solver: { maxToolCalls: 30 },
      antiLoop: { staleThreshold: 5 },
      reflexion: { enabled: true, maxSameVulnFails: 3 },
    })

    // All fields should be present
    expect(config.budgetPolicy).toBeDefined()
    expect(config.budgetPolicy!.enforcement).toBe('hard')
    expect(config.providerRateLimits).toBeDefined()
    expect(config.providerRateLimits!.groq.requestsPerMinute).toBe(30)
    expect(config.modelCapabilities).toBeDefined()
    expect(config.modelCapabilities!['groq/llama3-8b-8192'].contextWindow).toBe(8192)
    expect(config.spider).toBeDefined()
    expect(config.spider!.maxSteps).toBe(30)
    expect(config.solver).toEqual({ maxToolCalls: 30 })
    expect(config.antiLoop).toEqual({ staleThreshold: 5 })
    expect(config.reflexion).toEqual({ enabled: true, maxSameVulnFails: 3 })
    expect(config.verifier).toEqual(DEFAULTS.verifier)
  })
})
