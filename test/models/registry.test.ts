import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveModel } from '../../src/models/factory'
import { UltimatrixConfig } from '../../src/config'

function baseConfig(overrides: Partial<UltimatrixConfig> = {}): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    target: 'https://example.com',
    depth: 2,
    timeout: 60000,
    creds: { groq: { apiKey: 'gsk_test' } },
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    ...overrides,
  }
}

describe('Model Factory', () => {
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

  it('resolves default model', () => {
    const model = resolveModel(baseConfig())
    expect(model).toHaveProperty('modelId')
    expect((model as any).modelId).toBe('llama3-8b-8192')
    expect((model as any).specificationVersion).toBe('v2')
  })

  it('resolves tier-specific model', () => {
    const config = baseConfig({
      modelTiers: { fast: 'llama3-8b-8192', powerful: 'llama3-70b-8192' },
    })
    const fast = resolveModel(config, 'fast')
    expect((fast as any).modelId).toBe('llama3-8b-8192')

    const powerful = resolveModel(config, 'powerful')
    expect((powerful as any).modelId).toBe('llama3-70b-8192')
  })

  it('falls back to default for unconfigured tier', () => {
    const config = baseConfig()
    const model = resolveModel(config, 'powerful')
    expect((model as any).modelId).toBe('llama3-8b-8192')
  })

  it('cross-provider tier preserves exact model IDs', () => {
    const config = baseConfig({
      modelTiers: { powerful: 'anthropic/claude-sonnet-4' },
      creds: {
        groq: { apiKey: 'gsk_test' },
        anthropic: { apiKey: 'sk-ant-test' },
      },
    })
    const model = resolveModel(config, 'powerful')
    expect((model as any).modelId).toBe('anthropic/claude-sonnet-4')
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

  it('handles Bedrock IAM auth', () => {
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

  it('handles provider with custom baseUrl', () => {
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

  it('provides all three tiers', () => {
    const config = baseConfig({
      modelTiers: {
        fast: 'llama3-8b-8192',
        balanced: 'llama3-70b-8192',
        powerful: 'llama3-70b-8192',
      },
    })

    const fast = resolveModel(config, 'fast')
    const balanced = resolveModel(config, 'balanced')
    const powerful = resolveModel(config, 'powerful')

    expect((fast as any).modelId).toBe('llama3-8b-8192')
    expect((balanced as any).modelId).toBe('llama3-70b-8192')
    expect((powerful as any).modelId).toBe('llama3-70b-8192')
  })
})
