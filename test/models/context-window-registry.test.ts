import { describe, it, expect } from 'vitest'
import { ContextWindowRegistry } from '../../src/models/context-window-registry'
import type { UltimatrixConfig } from '../../src/config'

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

describe('ContextWindowRegistry', () => {
  describe('resolve', () => {
    it('returns entry from modelCapabilities', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'openai/gpt-4o': {
          contextWindow: 128000,
          maxOutputTokens: 16384,
          strengths: ['reasoning'],
          supportsStreaming: true,
          supportsStructuredOutput: true,
        },
      }))
      const entry = registry.resolve('openai/gpt-4o')
      expect(entry).toEqual({
        contextWindow: 128000,
        maxOutputTokens: 16384,
        reservedMargin: 1024,
      })
    })

    it('returns null for unknown model', () => {
      const registry = new ContextWindowRegistry(makeConfig({}))
      expect(registry.resolve('unknown/model')).toBeNull()
    })

    it('returns null when modelCapabilities is undefined', () => {
      const registry = new ContextWindowRegistry(makeConfig())
      expect(registry.resolve('openai/gpt-4o')).toBeNull()
    })

    it('uses reservedMargin from config when specified', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'groq/llama3-8b-8192': {
          contextWindow: 8192,
          maxOutputTokens: 2048,
          reservedMargin: 512,
          strengths: ['fast'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
        },
      }))
      const entry = registry.resolve('groq/llama3-8b-8192')
      expect(entry?.reservedMargin).toBe(512)
    })

    it('defaults reservedMargin to 1024 when not specified', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'groq/llama3-8b-8192': {
          contextWindow: 8192,
          maxOutputTokens: 2048,
          strengths: ['fast'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
        },
      }))
      const entry = registry.resolve('groq/llama3-8b-8192')
      expect(entry?.reservedMargin).toBe(1024)
    })
  })

  describe('getContextWindow', () => {
    it('returns context window for known model', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'openai/gpt-4o': {
          contextWindow: 128000,
          maxOutputTokens: 16384,
          strengths: ['reasoning'],
          supportsStreaming: true,
          supportsStructuredOutput: true,
        },
      }))
      expect(registry.getContextWindow('openai/gpt-4o')).toBe(128000)
    })

    it('returns 0 for unknown model', () => {
      const registry = new ContextWindowRegistry(makeConfig({}))
      expect(registry.getContextWindow('unknown/model')).toBe(0)
    })
  })

  describe('getMaxOutput', () => {
    it('returns max output for known model', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'openai/gpt-4o': {
          contextWindow: 128000,
          maxOutputTokens: 16384,
          strengths: ['reasoning'],
          supportsStreaming: true,
          supportsStructuredOutput: true,
        },
      }))
      expect(registry.getMaxOutput('openai/gpt-4o')).toBe(16384)
    })

    it('returns 0 for unknown model', () => {
      const registry = new ContextWindowRegistry(makeConfig({}))
      expect(registry.getMaxOutput('unknown/model')).toBe(0)
    })
  })

  describe('fitsInContext', () => {
    it('returns true when tokens fit within window minus margin', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'openai/gpt-4o': {
          contextWindow: 128000,
          maxOutputTokens: 16384,
          strengths: ['reasoning'],
          supportsStreaming: true,
          supportsStructuredOutput: true,
        },
      }))
      // 128000 - 1024 = 126976 available
      expect(registry.fitsInContext('openai/gpt-4o', 100000, 10000)).toBe(true)
    })

    it('returns false when tokens exceed window minus margin', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'openai/gpt-4o': {
          contextWindow: 128000,
          maxOutputTokens: 16384,
          strengths: ['reasoning'],
          supportsStreaming: true,
          supportsStructuredOutput: true,
        },
      }))
      // 128000 - 1024 = 126976 available; 120000 + 10000 = 130000 > 126976
      expect(registry.fitsInContext('openai/gpt-4o', 120000, 10000)).toBe(false)
    })

    it('returns false for unknown model', () => {
      const registry = new ContextWindowRegistry(makeConfig({}))
      expect(registry.fitsInContext('unknown/model', 100, 100)).toBe(false)
    })

    it('respects custom reservedMargin', () => {
      const registry = new ContextWindowRegistry(makeConfig({
        'groq/llama3-8b-8192': {
          contextWindow: 8192,
          maxOutputTokens: 2048,
          reservedMargin: 2048,
          strengths: ['fast'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
        },
      }))
      // 8192 - 2048 = 6144 available; 5000 + 1000 = 6000 < 6144 → fits
      expect(registry.fitsInContext('groq/llama3-8b-8192', 5000, 1000)).toBe(true)
      // 5000 + 2000 = 7000 > 6144 → doesn't fit
      expect(registry.fitsInContext('groq/llama3-8b-8192', 5000, 2000)).toBe(false)
    })
  })
})
