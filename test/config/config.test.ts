import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateConfig } from '../../src/config'
import { resolveModel } from '../../src/models/factory'
import type { UltimatrixConfig } from '../../src/config'
import { DEFAULTS } from '../../src/config'

function baseConfig(overrides: Partial<UltimatrixConfig> = {}): UltimatrixConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    target: 'https://example.com',
    depth: 2,
    timeout: 60000,
    creds: { openai: { apiKey: 'test-key' } },
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    ...overrides,
  }
}

describe('validateConfig', () => {
  it('throws when provider is missing', () => {
    expect(() => validateConfig({ model: 'gpt-4o', target: 'https://example.com', creds: {} })).toThrow('provider is required')
  })

  it('throws when model is missing', () => {
    expect(() => validateConfig({ provider: 'openai', target: 'https://example.com', creds: {} })).toThrow('model is required')
  })

  it('allows missing target (can be provided via CLI -t flag)', () => {
    expect(() => validateConfig({ provider: 'openai', model: 'gpt-4o', creds: { openai: { apiKey: 'test' } } })).not.toThrow()
  })

  it('throws when primary provider creds missing', () => {
    expect(() => validateConfig({ provider: 'openai', model: 'gpt-4o', target: 'https://example.com', creds: {} })).toThrow('creds.openai is required')
  })

  it('throws for unknown provider', () => {
    expect(() => validateConfig({ provider: 'unknown', model: 'x', target: 'https://example.com', creds: {} })).toThrow('unknown provider')
  })

  it('validates modelTiers cross-provider creds', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      target: 'https://example.com',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      modelTiers: { powerful: { provider: 'anthropic', model: 'claude-sonnet-4' } },
    })).toThrow('creds.anthropic is required')
  })

  it('passes with valid config', () => {
    const config = validateConfig({
      provider: 'openai',
      model: 'gpt-4o',
      target: 'https://example.com',
      creds: { openai: { apiKey: 'sk-test' } },
    })
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
    expect(config.target).toBe('https://example.com')
  })

  it('applies defaults for optional fields', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      target: 'https://example.com',
      creds: { groq: { apiKey: 'gsk_xxx' } },
    })
    expect(config.depth).toBe(2)
    expect(config.timeout).toBe(60000)
    expect(config.browser.headless).toBe(true)
    expect(config.browser.viewport).toEqual({ width: 1280, height: 720 })
    expect(config.memory.lastMessages).toBe(10)
    expect(config.agent.maxSteps).toBe(25)
    expect(config.rateLimit.requestsPerMinute).toBe(15)
    expect(config.rateLimit.maxConcurrent).toBe(2)
    expect(config.rateLimit.retryOnLimit).toBe(true)
    expect(config.rateLimit.maxRetries).toBe(3)
  })

  it('uses user-provided rateLimit values', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      target: 'https://example.com',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      rateLimit: { requestsPerMinute: 25, maxConcurrent: 2, retryOnLimit: false, maxRetries: 5 },
    })
    expect(config.rateLimit.requestsPerMinute).toBe(25)
    expect(config.rateLimit.maxConcurrent).toBe(2)
    expect(config.rateLimit.retryOnLimit).toBe(false)
    expect(config.rateLimit.maxRetries).toBe(5)
  })

  it('uses user-provided optional values', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      target: 'https://example.com',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      depth: 5,
      timeout: 30000,
      browser: { headless: false, viewport: { width: 1920, height: 1080 } },
      memory: { lastMessages: 20, semanticRecall: true, workingMemory: false },
      agent: { maxSteps: 100, scansDir: './output' },
    })
    expect(config.depth).toBe(5)
    expect(config.timeout).toBe(30000)
    expect(config.browser.headless).toBe(false)
    expect(config.browser.viewport).toEqual({ width: 1920, height: 1080 })
    expect(config.memory.lastMessages).toBe(20)
    expect(config.memory.semanticRecall).toBe(true)
    expect(config.agent.maxSteps).toBe(100)
    expect(config.agent.scansDir).toBe('./output')
  })
})

describe('engine config', () => {
  it('engine defaults to multi-model', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      target: 'https://example.com',
      creds: { groq: { apiKey: 'gsk_xxx' } },
    })
    expect(config.engine).toBe('multi-model')
    expect(config.solver).toBeUndefined()
    expect(config.antiLoop).toBeUndefined()
    expect(config.reflexion).toBeUndefined()
  })

  it('accepts engine=legacy', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      engine: 'legacy',
    })
    expect(config.engine).toBe('legacy')
  })

  it('coerces engine=solver to multi-model', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      engine: 'solver',
    })
    expect(config.engine).toBe('multi-model')
  })

  it('coerces engine=council to multi-model with deprecation', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      engine: 'council',
    })
    expect(config.engine).toBe('multi-model')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATION'))
    consoleSpy.mockRestore()
  })

  it('rejects invalid engine value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      engine: 'hybrid',
    })).toThrow('engine must be "multi-model", "council", or "solver"')
  })

  it('accepts solver config block', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      engine: 'solver',
      solver: { maxToolCalls: 20, maxTokens: 50000, maxDurationMs: 120000, maxParallel: 3 },
    })
    expect(config.solver).toEqual({ maxToolCalls: 20, maxTokens: 50000, maxDurationMs: 120000, maxParallel: 3 })
  })

  it('accepts partial solver config', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      solver: { maxToolCalls: 15 },
    })
    expect(config.solver).toEqual({ maxToolCalls: 15 })
  })

  it('rejects solver.maxToolCalls with non-positive value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      solver: { maxToolCalls: -1 },
    })).toThrow('solver.maxToolCalls must be a positive number')
  })

  it('rejects solver.maxToolCalls with zero', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      solver: { maxToolCalls: 0 },
    })).toThrow('solver.maxToolCalls must be a positive number')
  })

  it('accepts antiLoop config block', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      antiLoop: { staleThreshold: 5, maxFailedTarget: 3 },
    })
    expect(config.antiLoop).toEqual({ staleThreshold: 5, maxFailedTarget: 3 })
  })

  it('rejects antiLoop with non-positive value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      antiLoop: { staleThreshold: 0 },
    })).toThrow('antiLoop.staleThreshold must be a positive number')
  })

  it('accepts reflexion config block', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      reflexion: { enabled: true, maxSameVulnFails: 3, maxTotalNoProgress: 5, escalationMaxLevel: 3 },
    })
    expect(config.reflexion).toEqual({ enabled: true, maxSameVulnFails: 3, maxTotalNoProgress: 5, escalationMaxLevel: 3 })
  })

  it('rejects reflexion.enabled with non-boolean', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      reflexion: { enabled: 'yes' as any },
    })).toThrow('reflexion.enabled must be a boolean')
  })

  it('rejects reflexion with non-positive numeric value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      reflexion: { maxSameVulnFails: -1 },
    })).toThrow('reflexion.maxSameVulnFails must be a positive number')
  })

  it('accepts all engine blocks together', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      engine: 'multi-model',
      solver: { maxToolCalls: 20 },
      antiLoop: { staleThreshold: 5 },
      reflexion: { enabled: true, maxSameVulnFails: 3 },
    })
    expect(config.engine).toBe('multi-model')
    expect(config.solver).toEqual({ maxToolCalls: 20 })
    expect(config.antiLoop).toEqual({ staleThreshold: 5 })
    expect(config.reflexion).toEqual({ enabled: true, maxSameVulnFails: 3 })
  })
})

describe('resolveModel', () => {
  const envBackup: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.endsWith('_API_KEY') || key.startsWith('AWS_') || key === 'AZURE_API_KEY') {
        envBackup[key] = process.env[key]
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    for (const key of Object.keys(envBackup)) {
      if (envBackup[key] === undefined) delete process.env[key]
      else process.env[key] = envBackup[key]
    }
    for (const key of Object.keys(envBackup)) delete envBackup[key]
  })

  it('returns a LanguageModelV2 with exact model ID for standard provider', () => {
    const config = baseConfig()
    const model = resolveModel(config)
    expect(model).toHaveProperty('modelId')
    expect(model).toHaveProperty('specificationVersion')
    expect((model as any).modelId).toBe('gpt-4o')
    expect((model as any).specificationVersion).toBe('v2')
  })

  it('returns tier-specific model with exact model ID', () => {
    const config = baseConfig({
      modelTiers: { fast: { provider: 'groq', model: 'llama3-8b-8192' } },
      creds: {
        openai: { apiKey: 'test-key' },
        groq: { apiKey: 'gsk_xxx' },
      },
    })
    const model = resolveModel(config, 'fast')
    expect((model as any).modelId).toBe('llama3-8b-8192')
  })

  it('falls back to default when tier not configured', () => {
    const config = baseConfig()
    const model = resolveModel(config, 'fast')
    expect((model as any).modelId).toBe('gpt-4o')
  })

  it('handles Azure provider', () => {
    const config = baseConfig({
      provider: 'azure',
      model: 'gpt-4',
      creds: {
        azure: { apiKey: 'azkey', endpoint: 'https://myendpoint.openai.azure.com', deployment: 'gpt-4', apiVersion: '2024-01-01' },
      },
    })
    const model = resolveModel(config)
    expect((model as any).modelId).toBe('gpt-4')
    expect((model as any).specificationVersion).toBe('v2')
  })

  it('handles Bedrock provider', () => {
    const config = baseConfig({
      provider: 'bedrock',
      model: 'claude-3',
      creds: {
        bedrock: { authMethod: 'iam', accessKeyId: 'AKID', secretAccessKey: 'SAK', region: 'us-east-1' },
      },
    })
    resolveModel(config)
    expect(process.env.AWS_ACCESS_KEY_ID).toBe('AKID')
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBe('SAK')
    expect(process.env.AWS_REGION).toBe('us-east-1')
  })

  it('handles provider with custom baseUrl in creds', () => {
    const config = baseConfig({
      provider: 'nvidia',
      model: 'nvidia/nemotron-3-super-120b-a12b',
      creds: {
        nvidia: { apiKey: 'nvkey', baseUrl: 'https://integrate.api.nvidia.com/v1' },
      },
    })
    const model = resolveModel(config)
    expect((model as any).modelId).toBe('nvidia/nemotron-3-super-120b-a12b')
    expect((model as any).specificationVersion).toBe('v2')
  })

  it('cross-provider tier preserves exact model IDs', () => {
    const config = baseConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      modelTiers: {
        fast: { provider: 'groq', model: 'llama3-8b-8192' },
        balanced: { provider: 'openai', model: 'gpt-4o' },
        powerful: { provider: 'anthropic', model: 'claude-sonnet-4' },
      },
      creds: {
        groq: { apiKey: 'gsk_xxx' },
        openai: { apiKey: 'sk_test' },
        anthropic: { apiKey: 'sk-ant-xxx' },
      },
    })

    const fast = resolveModel(config, 'fast')
    expect((fast as any).modelId).toBe('llama3-8b-8192')

    const balanced = resolveModel(config, 'balanced')
    expect((balanced as any).modelId).toBe('gpt-4o')

    const powerful = resolveModel(config, 'powerful')
    expect((powerful as any).modelId).toBe('claude-sonnet-4')
  })
})

describe('budgetPolicy validation', () => {
  it('accepts valid budget policy', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      budgetPolicy: {
        enforcement: 'hard',
        scope: 'turn',
        resetOn: 'turn',
        allocation: { brain: 0.4, workers: 0.5, spider: 0.1 },
        maxModelCallsPerTask: 20,
        trackTokens: true,
      },
    })).not.toThrow()
  })

  it('rejects allocation sum > 1.0', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      budgetPolicy: {
        enforcement: 'soft',
        scope: 'session',
        resetOn: 'never',
        allocation: { brain: 0.5, workers: 0.5, spider: 0.5 },
        maxModelCallsPerTask: 10,
        trackTokens: false,
      },
    })).toThrow('allocation sums')
  })

  it('rejects invalid enforcement value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      budgetPolicy: {
        enforcement: 'strict',
        scope: 'session',
        resetOn: 'never',
        allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
        maxModelCallsPerTask: 10,
        trackTokens: false,
      },
    })).toThrow('enforcement')
  })

  it('rejects invalid scope value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      budgetPolicy: {
        enforcement: 'soft',
        scope: 'global',
        resetOn: 'never',
        allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
        maxModelCallsPerTask: 10,
        trackTokens: false,
      },
    })).toThrow('scope')
  })

  it('rejects negative maxModelCallsPerTask', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      budgetPolicy: {
        enforcement: 'soft',
        scope: 'session',
        resetOn: 'never',
        allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
        maxModelCallsPerTask: -5,
        trackTokens: false,
      },
    })).toThrow('maxModelCallsPerTask')
  })
})

describe('providerRateLimits validation', () => {
  it('accepts valid provider rate limits', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      providerRateLimits: {
        groq: { requestsPerMinute: 30, tokensPerMinute: 100000, maxConcurrent: 3, retryOnLimit: true, maxRetries: 5 },
      },
    })).not.toThrow()
  })

  it('rejects negative requestsPerMinute', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      providerRateLimits: {
        groq: { requestsPerMinute: -10, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
      },
    })).toThrow('requestsPerMinute must be positive')
  })

  it('rejects negative tokensPerMinute', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      providerRateLimits: {
        groq: { requestsPerMinute: 30, tokensPerMinute: -1, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
      },
    })).toThrow('tokensPerMinute must be positive')
  })
})

describe('multi-model engine', () => {
  it('accepts multi-model engine', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      engine: 'multi-model',
    })).not.toThrow()
  })
})

describe('DEFAULTS extended fields', () => {
  it('has rateLimit defaults with new fields', () => {
    expect(DEFAULTS.rateLimit.backoffStrategy).toBe('stepped')
    expect(DEFAULTS.rateLimit.baseBackoffMs).toBe(2000)
    expect(DEFAULTS.rateLimit.maxBackoffMs).toBe(30000)
  })

  it('has budgetPolicy defaults', () => {
    expect(DEFAULTS.budgetPolicy.enforcement).toBe('soft')
    expect(DEFAULTS.budgetPolicy.scope).toBe('session')
    expect(DEFAULTS.budgetPolicy.resetOn).toBe('never')
    expect(DEFAULTS.budgetPolicy.allocation).toEqual({ brain: 0.3, workers: 0.6, spider: 0.1 })
    expect(DEFAULTS.budgetPolicy.maxModelCallsPerTask).toBe(15)
    expect(DEFAULTS.budgetPolicy.trackTokens).toBe(false)
  })
})

describe('spider config', () => {
  it('accepts spider.enabled boolean', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      spider: { enabled: false },
    })
    expect(config.spider?.enabled).toBe(false)
  })

  it('accepts spider with all fields', () => {
    const config = validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      spider: { enabled: true, maxSteps: 10, maxDurationMs: 60000 },
    })
    expect(config.spider).toEqual({ enabled: true, maxSteps: 10, maxDurationMs: 60000 })
  })

  it('rejects spider.enabled with non-boolean', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      spider: { enabled: 'yes' as any },
    })).toThrow('spider.enabled must be a boolean')
  })

  it('rejects spider.maxSteps with non-positive value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      spider: { maxSteps: 0 },
    })).toThrow('spider.maxSteps must be a positive number')
  })

  it('rejects spider.maxDurationMs with negative value', () => {
    expect(() => validateConfig({
      provider: 'groq',
      model: 'llama3-8b-8192',
      creds: { groq: { apiKey: 'gsk_xxx' } },
      spider: { maxDurationMs: -1 },
    })).toThrow('spider.maxDurationMs must be a positive number')
  })
})
