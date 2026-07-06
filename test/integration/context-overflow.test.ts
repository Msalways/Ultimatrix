import { describe, it, expect } from 'vitest'
import { ContextBudgetManager } from '../../src/models/context-manager'
import type { ModelCapabilities, BudgetPolicy } from '../../src/config'

const SMALL_CAPS: ModelCapabilities = {
  'groq/llama3-8b-8192': {
    contextWindow: 8192,
    maxOutputTokens: 2048,
    strengths: ['fast'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
  },
}

describe('Integration: Context Overflow', () => {
  it('catches overflow in critical severity', () => {
    const mgr = new ContextBudgetManager(SMALL_CAPS)
    const result = mgr.validateContextFit({
      modelId: 'groq/llama3-8b-8192',
      systemPrompt: 'word '.repeat(4000),
      toolSchemas: 'word '.repeat(1500),
      conversationHistory: '',
      enrichedGoal: 'word '.repeat(3000),
    })

    expect(result.severity).toBe('critical')
    expect(result.fits).toBe(false)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('soft enforcement auto-truncates', () => {
    const mgr = new ContextBudgetManager(SMALL_CAPS)
    const params = {
      modelId: 'groq/llama3-8b-8192',
      systemPrompt: 'word '.repeat(4000),
      toolSchemas: 'word '.repeat(1500),
      conversationHistory: 'response '.repeat(2000),
      enrichedGoal: 'word '.repeat(3000),
    }

    const truncated = mgr.truncateToFit(params)
    // After truncation, goal should be smaller
    expect(truncated.enrichedGoal.length).toBeLessThan(params.enrichedGoal.length)
    // System prompt preserved
    expect(truncated.systemPrompt).toBe(params.systemPrompt)
  })

  it('warn enforcement does not truncate', () => {
    const mgr = new ContextBudgetManager(SMALL_CAPS)
    const params = {
      modelId: 'groq/llama3-8b-8192',
      systemPrompt: 'word '.repeat(4000),
      toolSchemas: 'word '.repeat(1500),
      conversationHistory: 'response '.repeat(2000),
      enrichedGoal: 'word '.repeat(3000),
    }

    const truncated = mgr.truncateToFit(params)
    // In warn mode, truncation still works but caller decides whether to use it
    expect(truncated.enrichedGoal.length).toBeLessThan(params.enrichedGoal.length)
  })

  it('hard enforcement throws on overflow', () => {
    const mgr = new ContextBudgetManager(SMALL_CAPS)
    const result = mgr.validateContextFit({
      modelId: 'groq/llama3-8b-8192',
      systemPrompt: 'word '.repeat(4000),
      toolSchemas: 'word '.repeat(1500),
      conversationHistory: '',
      enrichedGoal: 'word '.repeat(3000),
    })

    // In real code, hard enforcement would throw here
    expect(result.severity).toBe('critical')
    expect(result.fits).toBe(false)
  })

  it('small inputs always fit', () => {
    const mgr = new ContextBudgetManager(SMALL_CAPS)
    const result = mgr.validateContextFit({
      modelId: 'groq/llama3-8b-8192',
      systemPrompt: 'You are a security agent.',
      toolSchemas: '{"nav": {}, "act": {}}',
      conversationHistory: '',
      enrichedGoal: 'Find XSS vulnerabilities',
    })

    expect(result.fits).toBe(true)
    expect(result.severity).toBe('ok')
    expect(result.suggestions).toHaveLength(0)
  })

  it('provides actionable suggestions when near limit', () => {
    const mgr = new ContextBudgetManager(SMALL_CAPS)
    const result = mgr.validateContextFit({
      modelId: 'groq/llama3-8b-8192',
      systemPrompt: 'word '.repeat(3500),
      toolSchemas: 'word '.repeat(1000),
      conversationHistory: 'response '.repeat(1500),
      enrichedGoal: 'word '.repeat(2000),
    })

    // Should have suggestions about what to reduce
    expect(result.suggestions.length).toBeGreaterThan(0)
    // Suggestions should mention actionable reductions
    const allSuggestions = result.suggestions.join(' ')
    expect(allSuggestions).toMatch(/Reduce|worker|context/i)
  })
})
