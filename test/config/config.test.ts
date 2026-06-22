import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateConfig } from '../../src/config'
import { resolveModel } from '../../src/models/factory'
import type { UltimatrixConfig } from '../../src/config'

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
      modelTiers: { powerful: 'anthropic/claude-sonnet-4' },
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
    expect(config.agent.maxSteps).toBe(50)
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
      modelTiers: { fast: 'groq/llama3-8b-8192' },
      creds: {
        openai: { apiKey: 'test-key' },
        groq: { apiKey: 'gsk_xxx' },
      },
    })
    const model = resolveModel(config, 'fast')
    expect((model as any).modelId).toBe('groq/llama3-8b-8192')
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
        fast: 'groq/llama3-8b-8192',
        balanced: 'openai/gpt-4o',
        powerful: 'anthropic/claude-sonnet-4',
      },
      creds: {
        groq: { apiKey: 'gsk_xxx' },
        openai: { apiKey: 'sk_test' },
        anthropic: { apiKey: 'sk-ant-xxx' },
      },
    })

    const fast = resolveModel(config, 'fast')
    expect((fast as any).modelId).toBe('groq/llama3-8b-8192')

    const balanced = resolveModel(config, 'balanced')
    expect((balanced as any).modelId).toBe('openai/gpt-4o')

    const powerful = resolveModel(config, 'powerful')
    expect((powerful as any).modelId).toBe('anthropic/claude-sonnet-4')
  })
})
