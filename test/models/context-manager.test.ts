import { describe, it, expect } from 'vitest'
import { ContextBudgetManager, type ContextFitParams, type ContextValidation } from '../../src/models/context-manager'
import type { ModelCapabilities } from '../../src/config'

const SMALL_MODEL_CAPS: ModelCapabilities = {
  'groq/llama3-8b-8192': {
    contextWindow: 8192,
    maxOutputTokens: 2048,
    strengths: ['fast'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
  },
}

const LARGE_MODEL_CAPS: ModelCapabilities = {
  'openai/gpt-4o': {
    contextWindow: 128000,
    maxOutputTokens: 16384,
    strengths: ['general'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  },
}

const MULTI_MODEL_CAPS: ModelCapabilities = {
  ...SMALL_MODEL_CAPS,
  ...LARGE_MODEL_CAPS,
}

function makeParams(overrides?: Partial<ContextFitParams>): ContextFitParams {
  return {
    modelId: 'groq/llama3-8b-8192',
    systemPrompt: 'You are a security testing agent.',
    toolSchemas: '{"navigate": {...}, "act": {...}}',
    conversationHistory: '',
    enrichedGoal: 'Find XSS vulnerabilities',
    ...overrides,
  }
}

describe('ContextBudgetManager', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      expect(mgr.estimateTokens('')).toBe(0)
    })

    it('estimates tokens for simple text', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      const tokens = mgr.estimateTokens('The quick brown fox jumps over the lazy dog')
      expect(tokens).toBeGreaterThan(5)
      expect(tokens).toBeLessThan(20)
    })

    it('estimates more tokens for longer text', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      const short = mgr.estimateTokens('hello world')
      const long = mgr.estimateTokens('hello world '.repeat(100))
      expect(long).toBeGreaterThan(short)
    })

    it('handles code-heavy text with more overhead', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      const plain = mgr.estimateTokens('hello world test sentence here')
      const code = mgr.estimateTokens('function test() { return { a: 1, b: 2 }; }')
      // Code text should estimate slightly higher per word due to special chars
      expect(code).toBeGreaterThanOrEqual(plain)
    })
  })

  describe('validateContextFit', () => {
    it('returns ok when context fits easily', () => {
      const mgr = new ContextBudgetManager(LARGE_MODEL_CAPS)
      const result = mgr.validateContextFit(makeParams({
        modelId: 'openai/gpt-4o',
        systemPrompt: 'Short prompt',
        toolSchemas: '{}',
        enrichedGoal: 'Find bugs',
      }))
      expect(result.severity).toBe('ok')
      expect(result.fits).toBe(true)
      expect(result.totalInputTokens).toBeGreaterThan(0)
      expect(result.availableForOutput).toBeGreaterThan(0)
    })

    it('returns warning when context is 85%+ full', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      const result = mgr.validateContextFit(makeParams({
        modelId: 'groq/llama3-8b-8192',
        systemPrompt: 'word '.repeat(5000),
        toolSchemas: 'word '.repeat(2000),
        enrichedGoal: 'word '.repeat(2000),
      }))
      expect(result.severity).toMatch(/warning|critical/)
      expect(result.suggestions.length).toBeGreaterThan(0)
    })

    it('returns critical when context is 97%+ full', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      // Use spaced text so token estimation works properly
      const result = mgr.validateContextFit(makeParams({
        modelId: 'groq/llama3-8b-8192',
        systemPrompt: 'word '.repeat(7000),
        toolSchemas: 'word '.repeat(2000),
        enrichedGoal: 'word '.repeat(2000),
      }))
      expect(result.severity).toBe('critical')
      expect(result.fits).toBe(false)
    })

    it('returns breakdown with all components', () => {
      const mgr = new ContextBudgetManager(LARGE_MODEL_CAPS)
      const result = mgr.validateContextFit(makeParams({
        modelId: 'openai/gpt-4o',
        systemPrompt: 'Test prompt',
        toolSchemas: '{"test": true}',
        conversationHistory: 'user: hello\nagent: hi',
        enrichedGoal: 'Find XSS',
      }))
      expect(result.breakdown.system).toBeGreaterThan(0)
      expect(result.breakdown.tools).toBeGreaterThan(0)
      expect(result.breakdown.history).toBeGreaterThan(0)
      expect(result.breakdown.goal).toBeGreaterThan(0)
    })

    it('handles unknown model gracefully', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      const result = mgr.validateContextFit(makeParams({
        modelId: 'unknown/model',
        systemPrompt: 'Short',
        toolSchemas: '{}',
        enrichedGoal: 'Test',
      }))
      // Falls back to default 8192 context
      expect(result.severity).toBeDefined()
      expect(result.breakdown.system).toBeGreaterThan(0)
    })

    it('expectedOutputTokens affects availableForOutput', () => {
      const mgr = new ContextBudgetManager(LARGE_MODEL_CAPS)
      // More expected output → less available for output
      const withMoreOutput = mgr.validateContextFit(makeParams({
        modelId: 'openai/gpt-4o',
        expectedOutputTokens: 15000,
      }))
      const withLessOutput = mgr.validateContextFit(makeParams({
        modelId: 'openai/gpt-4o',
        expectedOutputTokens: 2000,
      }))
      expect(withMoreOutput.availableForOutput).toBeLessThan(withLessOutput.availableForOutput)
    })
  })

  describe('suggestReductions', () => {
    it('returns empty when not near limit', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      const suggestions = mgr.suggestReductions(
        { system: 100, tools: 50, history: 200, goal: 300 },
        6000,
        8192,
      )
      expect(suggestions.length).toBe(0)
    })

    it('suggests reducing largest contributor first', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      // 8192 * 0.85 = 6963 threshold; total must exceed this
      const suggestions = mgr.suggestReductions(
        { system: 100, tools: 50, history: 5500, goal: 2000 },
        100,
        8192,
      )
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0]).toContain('history')
    })

    it('suggests worker delegation when overflow', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      // Total must exceed 6963 (85% of 8192)
      const suggestions = mgr.suggestReductions(
        { system: 3000, tools: 2000, history: 2000, goal: 2000 },
        0,
        8192,
      )
      expect(suggestions.some(s => s.includes('worker'))).toBe(true)
    })
  })

  describe('truncateToFit', () => {
    it('returns original when already fits', () => {
      const mgr = new ContextBudgetManager(LARGE_MODEL_CAPS)
      const params = makeParams({
        modelId: 'openai/gpt-4o',
        enrichedGoal: 'Short goal',
        conversationHistory: 'Brief history',
      })
      const result = mgr.truncateToFit(params, 100000)
      expect(result.enrichedGoal).toBe('Short goal')
      expect(result.conversationHistory).toBe('Brief history')
    })

    it('truncates enriched goal when too large', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      // Use spaced text so token estimation works, and make it much larger than budget
      const largeGoal = 'word '.repeat(10000)
      const params = makeParams({
        modelId: 'groq/llama3-8b-8192',
        enrichedGoal: largeGoal,
        conversationHistory: 'response '.repeat(3000),
      })
      const result = mgr.truncateToFit(params)
      expect(result.enrichedGoal.length).toBeLessThan(largeGoal.length)
      // Truncation is performed by the section-aware compactor, which emits a
      // structural omission marker (e.g. "[NNNN chars omitted]") rather than a
      // free-text banner. Assert on that real signal.
      expect(result.enrichedGoal).toMatch(/chars omitted/)
    })

    it('preserves system prompt and tool schemas', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      const params = makeParams({
        modelId: 'groq/llama3-8b-8192',
        systemPrompt: 'Important system instructions',
        toolSchemas: '{"nav": {}, "act": {}}',
        enrichedGoal: 'x'.repeat(50000),
      })
      const result = mgr.truncateToFit(params)
      expect(result.systemPrompt).toBe('Important system instructions')
      expect(result.toolSchemas).toBe('{"nav": {}, "act": {}}')
    })
  })

  describe('getContextWindow / getMaxOutput', () => {
    it('returns context window for known model', () => {
      const mgr = new ContextBudgetManager(LARGE_MODEL_CAPS)
      expect(mgr.getContextWindow('openai/gpt-4o')).toBe(128000)
    })

    it('returns default for unknown model', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      expect(mgr.getContextWindow('unknown/model')).toBe(8192)
    })

    it('returns max output for known model', () => {
      const mgr = new ContextBudgetManager(LARGE_MODEL_CAPS)
      expect(mgr.getMaxOutput('openai/gpt-4o')).toBe(16384)
    })

    it('returns default max output for unknown model', () => {
      const mgr = new ContextBudgetManager(SMALL_MODEL_CAPS)
      expect(mgr.getMaxOutput('unknown/model')).toBe(2048)
    })
  })
})
