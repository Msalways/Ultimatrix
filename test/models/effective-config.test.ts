import { describe, expect, it } from 'vitest'
import { resolveEffectiveConfig } from '../../src/models/effective-config'
import { resolveModelRef } from '../../src/models/routing'
import type { UltimatrixConfig } from '../../src/config'

function config(overrides: Partial<UltimatrixConfig> = {}): UltimatrixConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    depth: 2,
    timeout: 60000,
    creds: { openai: { apiKey: 'sk-test' }, groq: { apiKey: 'gsk-test' } },
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 25, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 15, maxConcurrent: 2, retryOnLimit: true, maxRetries: 3 },
    modelCapabilities: {
      'groq/llama3-8b-8192': { contextWindow: 8192, maxOutputTokens: 2048, strengths: ['fast'], supportsStreaming: true, supportsStructuredOutput: false },
      'openai/gpt-4o-mini': { contextWindow: 128000, maxOutputTokens: 16384, strengths: ['balanced'], supportsStreaming: true, supportsStructuredOutput: true },
      'openai/gpt-4o': { contextWindow: 128000, maxOutputTokens: 16384, strengths: ['reasoning'], supportsStreaming: true, supportsStructuredOutput: true },
    },
    modelTiers: {
      fast: { provider: 'groq', model: 'llama3-8b-8192' },
      balanced: { provider: 'openai', model: 'gpt-4o-mini' },
      powerful: { provider: 'openai', model: 'gpt-4o' },
    },
    ...overrides,
  }
}

describe('effective config resolver', () => {
  it('maps stable modules through configured tiers', () => {
    const cfg = config({ modelRoleTiers: { brain: 'powerful', spider: 'fast', council: 'powerful' } })
    const effective = resolveEffectiveConfig(cfg)

    expect(effective.modules.brain.modelId).toBe('openai/gpt-4o')
    expect(effective.modules.spider.modelId).toBe('groq/llama3-8b-8192')
    expect(effective.workers.high.tier).toBe('powerful')
    expect(resolveModelRef(cfg, { role: 'brain' }).modelId).toBe('openai/gpt-4o')
  })

  it('keeps explicit modelRoles as advanced overrides', () => {
    const effective = resolveEffectiveConfig(config({
      modelRoleTiers: { brain: 'powerful' },
      modelRoles: { brain: { provider: 'groq', model: 'llama3-8b-8192' } },
    }))

    expect(effective.modules.brain.modelId).toBe('groq/llama3-8b-8192')
    expect(effective.modules.brain.advancedOverride).toBe(true)
  })

  it('treats providerKeys as configured credentials', () => {
    const effective = resolveEffectiveConfig(config({
      creds: {},
      providerKeys: { openai: { apiKey: 'sk-test' } },
      modelTiers: {
        fast: { provider: 'openai', model: 'gpt-4o-mini' },
        balanced: { provider: 'openai', model: 'gpt-4o-mini' },
        powerful: { provider: 'openai', model: 'gpt-4o' },
      },
    }))

    expect(effective.defaultModel.credentialConfigured).toBe(true)
    expect(effective.errors).not.toContain('credentials missing for default provider: openai')
  })

  it('treats empty-string api keys as missing credentials', () => {
    const effective = resolveEffectiveConfig(config({
      creds: { openai: { apiKey: '' }, groq: { apiKey: 'gsk-test' } },
    }))

    expect(effective.defaultModel.credentialConfigured).toBe(false)
    expect(effective.errors).toContain('credentials missing for default provider: openai')
  })

  it('warns on unknown capabilities and untrusted mcp', () => {
    const effective = resolveEffectiveConfig(config({
      modelCapabilities: {},
      mcp: [{ name: 'third-party', command: 'tool' }],
    }))

    expect(effective.status).toBe('warning')
    expect(effective.warnings).toContain('modelCapabilities missing for openai/gpt-4o-mini')
    expect(effective.warnings).toContain('mcp.third-party: untrusted')
  })
})
