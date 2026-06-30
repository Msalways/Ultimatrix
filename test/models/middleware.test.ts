import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wrapModel } from '../../src/models/middleware'
import { resetSharedInstances } from '../../src/models/rate-limiter'
import type { UltimatrixConfig } from '../../src/config'

function createMockModel() {
  let callCount = 0
  return {
    doStream: vi.fn(async (..._args: any[]) => {
      callCount++
      return { type: 'stream', callCount }
    }),
    doGenerate: vi.fn(async (..._args: any[]) => {
      callCount++
      return { type: 'generate', callCount }
    }),
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: 'mock-model',
    defaultObjectGenerationMode: undefined,
  }
}

function makeConfig(overrides?: Partial<UltimatrixConfig['rateLimit']>): UltimatrixConfig {
  return {
    provider: 'mock',
    model: 'mock-model',
    depth: 2,
    timeout: 60000,
    creds: {},
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: {
      requestsPerMinute: 60,
      maxConcurrent: 3,
      retryOnLimit: true,
      maxRetries: 3,
      ...overrides,
    },
  }
}

describe('wrapModel', () => {
  beforeEach(() => {
    resetSharedInstances()
  })

  afterEach(() => {
    resetSharedInstances()
  })

  it('passes through when rate limiting disabled (requestsPerMinute: 0)', async () => {
    const model = createMockModel()
    const config = makeConfig({ requestsPerMinute: 0 })
    const wrapped = wrapModel(model as any, config)

    const result = await (wrapped as any).doStream({ prompt: 'test' })
    expect(result.type).toBe('stream')
    expect(model.doStream).toHaveBeenCalledOnce()
  })

  it('calls doStream through proxy', async () => {
    const model = createMockModel()
    const config = makeConfig({ requestsPerMinute: 60, maxConcurrent: 5 })
    const wrapped = wrapModel(model as any, config)

    const result = await (wrapped as any).doStream({ prompt: 'test' })
    expect(result.type).toBe('stream')
  })

  it('calls doGenerate through proxy', async () => {
    const model = createMockModel()
    const config = makeConfig({ requestsPerMinute: 60, maxConcurrent: 5 })
    const wrapped = wrapModel(model as any, config)

    const result = await (wrapped as any).doGenerate({ prompt: 'test' })
    expect(result.type).toBe('generate')
  })

  it('passes through non-intercepted properties', async () => {
    const model = createMockModel()
    const config = makeConfig()
    const wrapped = wrapModel(model as any, config)

    expect((wrapped as any).provider).toBe('mock')
    expect((wrapped as any).modelId).toBe('mock-model')
  })

  it('retries on rate limit error', async () => {
    const model = createMockModel()
    let attempts = 0
    model.doStream.mockImplementation(async () => {
      attempts++
      if (attempts <= 2) {
        throw new Error('ResourceExhausted: rate limit')
      }
      return { type: 'stream', success: true }
    })

    const config = makeConfig({ requestsPerMinute: 120, maxConcurrent: 5, retryOnLimit: true, maxRetries: 3 })
    const wrapped = wrapModel(model as any, config)

    const result = await (wrapped as any).doStream({ prompt: 'test' })
    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
  }, 15000)

  it('throws after max retries exhausted', async () => {
    const model = createMockModel()
    model.doStream.mockRejectedValue(new Error('ResourceExhausted: rate limit'))

    const config = makeConfig({ requestsPerMinute: 120, maxConcurrent: 5, retryOnLimit: true, maxRetries: 2 })
    const wrapped = wrapModel(model as any, config)

    await expect((wrapped as any).doStream({ prompt: 'test' })).rejects.toThrow('ResourceExhausted')
  }, 15000)

  it('does not retry on non-rate-limit errors', async () => {
    const model = createMockModel()
    let attempts = 0
    model.doStream.mockImplementation(async () => {
      attempts++
      throw new Error('Connection refused')
    })

    const config = makeConfig({ requestsPerMinute: 120, maxConcurrent: 5, retryOnLimit: true, maxRetries: 3 })
    const wrapped = wrapModel(model as any, config)

    await expect((wrapped as any).doStream({ prompt: 'test' })).rejects.toThrow('Connection refused')
    expect(attempts).toBe(1)
  })

  it('does not retry when retryOnLimit is false', async () => {
    const model = createMockModel()
    let attempts = 0
    model.doStream.mockImplementation(async () => {
      attempts++
      throw new Error('429 Too Many Requests')
    })

    const config = makeConfig({ requestsPerMinute: 120, maxConcurrent: 5, retryOnLimit: false, maxRetries: 3 })
    const wrapped = wrapModel(model as any, config)

    await expect((wrapped as any).doStream({ prompt: 'test' })).rejects.toThrow('429')
    expect(attempts).toBe(1)
  })

  it('concurrency control limits parallel calls', async () => {
    const model = createMockModel()
    let concurrent = 0
    let maxConcurrent = 0

    model.doStream.mockImplementation(async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 50))
      concurrent--
      return { type: 'stream' }
    })

    const config = makeConfig({ requestsPerMinute: 600, maxConcurrent: 2 })
    const wrapped = wrapModel(model as any, config)

    const promises = Array.from({ length: 5 }, () =>
      (wrapped as any).doStream({ prompt: 'test' })
    )

    await Promise.all(promises)

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  }, 15000)
})
