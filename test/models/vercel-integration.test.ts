import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveModel } from '../../src/models/factory'
import { UltimatrixConfig } from '../../src/config'

describe('Vercel AI SDK Integration via Model Factory', () => {
  const envBackup: Record<string, string | undefined> = {}

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

  it('returns LanguageModelV2 with exact model ID', () => {
    const config = baseConfig()
    const model = resolveModel(config)
    expect((model as any).modelId).toBe('gpt-4o')
    expect((model as any).specificationVersion).toBe('v2')
  })

  it('cross-provider tier preserves exact model IDs', () => {
    const config = baseConfig({
      modelTiers: {
        fast: { provider: 'groq', model: 'llama3-8b-8192' },
        balanced: { provider: 'openai', model: 'gpt-4o' },
        powerful: { provider: 'anthropic', model: 'claude-sonnet-4' },
      },
      creds: {
        groq: { apiKey: 'gsk_test' },
        openai: { apiKey: 'sk_test' },
        anthropic: { apiKey: 'sk-ant_test' },
      },
    })

    const fast = resolveModel(config, 'fast')
    expect((fast as any).modelId).toBe('llama3-8b-8192')

    const balanced = resolveModel(config, 'balanced')
    expect((balanced as any).modelId).toBe('gpt-4o')

    const powerful = resolveModel(config, 'powerful')
    expect((powerful as any).modelId).toBe('claude-sonnet-4')
  })

  it('default tier falls back to primary config', () => {
    const config = baseConfig()
    const model = resolveModel(config, 'default')
    expect((model as any).modelId).toBe('gpt-4o')
  })

  it('Azure config produces correct structure', () => {
    const config = baseConfig({
      provider: 'azure',
      model: 'gpt-4',
      creds: {
        azure: { apiKey: 'azkey', endpoint: 'https://myresource.openai.azure.com', deployment: 'gpt-4-deploy', apiVersion: '2024-02-01' },
      },
    })
    const model = resolveModel(config)
    expect((model as any).modelId).toBe('gpt-4')
    expect((model as any).specificationVersion).toBe('v2')
  })

  it('Bedrock sets and cleans up env vars after model build', () => {
    const config = baseConfig({
      provider: 'bedrock',
      model: 'claude-3',
      creds: {
        bedrock: { authMethod: 'iam', accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'TK', region: 'eu-west-1' },
      },
    })
    const model = resolveModel(config)
    expect(model).toBeDefined()
    // Env vars are cleaned up after model build to prevent cross-provider pollution
    expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(process.env.AWS_SESSION_TOKEN).toBeUndefined()
    expect(process.env.AWS_REGION).toBeUndefined()
  })

  it('unknown provider creates model with exact ID', () => {
    const config = baseConfig({
      provider: 'unknown-provider',
      model: 'some-model',
      creds: { 'unknown-provider': { apiKey: 'test' } },
    })
    const model = resolveModel(config)
    expect((model as any).modelId).toBe('some-model')
    expect((model as any).specificationVersion).toBe('v2')
  })
})
