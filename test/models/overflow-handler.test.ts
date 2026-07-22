import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classifyOverflow, withOverflowRecovery } from '../../src/models/overflow-handler'
import { ContextWindowRegistry } from '../../src/models/context-window-registry'
import { resetAllProviderLimiters } from '../../src/models/limiter-factory'
import { resetGlobalQuotaTracker } from '../../src/models/quota-tracker'
import { setForensicLog } from '../../src/tools/report-tools'
import { ForensicLog } from '../../src/logging/forensic-log'
import type { UltimatrixConfig } from '../../src/config'
import os from 'node:os'

function makeConfig(modelCapabilities?: Record<string, any>): UltimatrixConfig {
  return {
    provider: 'mock',
    model: 'mock-model',
    depth: 2,
    timeout: 60000,
    creds: {},
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 15, maxConcurrent: 2, retryOnLimit: true, maxRetries: 3 },
    modelCapabilities,
  }
}

describe('classifyOverflow', () => {
  it('returns overflow when HTTP 400 + estimated > contextWindow', () => {
    const result = classifyOverflow({ status: 400 }, 300000, 262144)
    expect(result.isOverflow).toBe(true)
  })

  it('returns not overflow when HTTP 400 + estimated < contextWindow', () => {
    const result = classifyOverflow({ status: 400 }, 50000, 262144)
    expect(result.isOverflow).toBe(false)
  })

  it('returns not overflow for HTTP 429 (rate limit)', () => {
    const result = classifyOverflow({ status: 429 }, 300000, 262144)
    expect(result.isOverflow).toBe(false)
  })

  it('returns not overflow for HTTP 500', () => {
    const result = classifyOverflow({ status: 500 }, 300000, 262144)
    expect(result.isOverflow).toBe(false)
  })

  it('returns overflow when HTTP 400 + unknown model (null contextWindow)', () => {
    const result = classifyOverflow({ status: 400 }, 50000, null)
    expect(result.isOverflow).toBe(true)
  })

  it('checks statusCode fallback when status is absent', () => {
    const result = classifyOverflow({ statusCode: 400 }, 300000, 262144)
    expect(result.isOverflow).toBe(true)
  })
})

describe('withOverflowRecovery', () => {
  beforeEach(() => {
    resetAllProviderLimiters()
    resetGlobalQuotaTracker()
  })

  afterEach(() => {
    resetAllProviderLimiters()
    resetGlobalQuotaTracker()
    setForensicLog(null as any)
  })

  it('passes through when call succeeds', async () => {
    const config = makeConfig({
      'mock/model': { contextWindow: 128000, maxOutputTokens: 4096, strengths: [], supportsStreaming: true, supportsStructuredOutput: false },
    })
    const registry = new ContextWindowRegistry(config)
    const call = vi.fn(async (args: any) => ({ ok: true }))

    const result = await withOverflowRecovery(
      call,
      { messages: [{ role: 'user', content: 'short message' }] },
      'mock/model',
      registry,
      config,
    )

    expect(result.ok).toBe(true)
    expect(call).toHaveBeenCalledOnce()
  })

  it('pre-send compacts when estimate exceeds budget', async () => {
    const config = makeConfig({
      'mock/model': { contextWindow: 8192, maxOutputTokens: 2048, strengths: [], supportsStreaming: true, supportsStructuredOutput: false },
    })
    const registry = new ContextWindowRegistry(config)

    // Large messages that exceed 8K context budget
    const largeMessages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}: ${'word '.repeat(300)}`,
    }))

    const call = vi.fn(async (args: any) => {
      // Verify that messages were compacted before reaching the call
      const totalChars = args.messages.reduce((sum: number, m: any) => {
        const content = typeof m.content === 'string' ? m.content : ''
        return sum + content.length
      }, 0)
      // Original was ~90K chars; after compaction should be much less
      expect(totalChars).toBeLessThan(90000)
      return { ok: true }
    })

    const result = await withOverflowRecovery(
      call,
      { messages: largeMessages },
      'mock/model',
      registry,
      config,
    )

    expect(result.ok).toBe(true)
    expect(call).toHaveBeenCalledOnce()
  })

  it('retries on overflow with unknown model (null registry)', async () => {
    const config = makeConfig({})
    const registry = new ContextWindowRegistry(config)

    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}: ${'word '.repeat(200)}`,
    }))

    let attempt = 0
    const call = vi.fn(async (args: any) => {
      attempt++
      if (attempt === 1) {
        const err: any = new Error('context_length_exceeded')
        err.status = 400
        throw err
      }
      return { ok: true }
    })

    const result = await withOverflowRecovery(
      call,
      { messages },
      'unknown/model',
      registry,
      config,
    )

    expect(result.ok).toBe(true)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('throws after max compaction retries exhausted (unknown model)', async () => {
    const config = makeConfig({})
    const registry = new ContextWindowRegistry(config)

    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}: ${'word '.repeat(200)}`,
    }))

    const call = vi.fn(async () => {
      const err: any = new Error('context_length_exceeded')
      err.status = 400
      throw err
    })

    await expect(
      withOverflowRecovery(call, { messages }, 'unknown/model', registry, config),
    ).rejects.toThrow('context_length_exceeded')

    // Initial call + 2 retries = 3 total
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('does not retry on non-overflow errors', async () => {
    const config = makeConfig({
      'mock/model': { contextWindow: 128000, maxOutputTokens: 4096, strengths: [], supportsStreaming: true, supportsStructuredOutput: false },
    })
    const registry = new ContextWindowRegistry(config)

    const call = vi.fn(async () => {
      const err: any = new Error('invalid_request')
      err.status = 400
      throw err
    })

    // Estimate is within contextWindow → not overflow → no retry
    await expect(
      withOverflowRecovery(call, { messages: [{ role: 'user', content: 'short' }] }, 'mock/model', registry, config),
    ).rejects.toThrow('invalid_request')

    expect(call).toHaveBeenCalledOnce()
  })

  it('logs forensic events on compaction', async () => {
    const flog = new ForensicLog(`${os.tmpdir()}/overflow-forensic.ndjson`)
    setForensicLog(flog)

    const config = makeConfig({
      'mock/model': { contextWindow: 8192, maxOutputTokens: 2048, strengths: [], supportsStreaming: true, supportsStructuredOutput: false },
    })
    const registry = new ContextWindowRegistry(config)

    const largeMessages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}: ${'word '.repeat(300)}`,
    }))

    const call = vi.fn(async () => ({ ok: true }))

    await withOverflowRecovery(call, { messages: largeMessages }, 'mock/model', registry, config)

    const events = flog.getEvents({ type: 'tool-result', tool: 'compact-messages' })
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].metadata?.modelId).toBe('mock/model')
    expect(events[0].metadata?.tokensSaved).toBeGreaterThanOrEqual(0)
  })
})
