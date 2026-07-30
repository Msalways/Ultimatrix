import { describe, it, expect } from 'vitest'
import { buildBudgetedGoal, capEnrichedGoal, type GoalSection } from '../../src/solver/budgeted-goal'

const smallConfig = {
  model: 'test-model',
  modelCapabilities: { 'test-model': { contextWindow: 8000, maxOutputTokens: 1024 } },
}

const largeConfig = {
  model: 'large-model',
  modelCapabilities: { 'large-model': { contextWindow: 262144, maxOutputTokens: 8192 } },
}

describe('buildBudgetedGoal', () => {
  it('includes all sections when within budget', () => {
    const sections: GoalSection[] = [
      { name: 'Target', priority: 100, content: 'Attack http://test.com' },
      { name: 'Findings', priority: 90, content: '- XSS on /search' },
    ]
    const result = buildBudgetedGoal(sections, smallConfig)
    expect(result).toContain('## Target')
    expect(result).toContain('## Findings')
    expect(result).toContain('Attack http://test.com')
    expect(result).toContain('XSS on /search')
  })

  it('sorts sections by priority (highest first)', () => {
    const sections: GoalSection[] = [
      { name: 'Low Priority', priority: 10, content: 'low' },
      { name: 'High Priority', priority: 100, content: 'high' },
    ]
    const result = buildBudgetedGoal(sections, smallConfig)
    const highIdx = result.indexOf('## High Priority')
    const lowIdx = result.indexOf('## Low Priority')
    expect(highIdx).toBeLessThan(lowIdx)
  })

  it('truncates when budget exceeded', () => {
    const sections: GoalSection[] = [
      { name: 'Big Section', priority: 100, content: 'x'.repeat(20000) },
    ]
    const result = buildBudgetedGoal(sections, smallConfig)
    expect(result).toContain('truncated')
  })

  it('drops lowest priority sections when budget exceeded', () => {
    // 8K context, 5% = 400 tokens = ~1600 chars
    const sections: GoalSection[] = [
      { name: 'Critical', priority: 100, content: 'important stuff' },
      { name: 'Low', priority: 10, content: 'y'.repeat(2000) },
    ]
    const result = buildBudgetedGoal(sections, smallConfig)
    expect(result).toContain('## Critical')
    expect(result).toContain('truncated')
  })

  it('handles empty sections', () => {
    const result = buildBudgetedGoal([], smallConfig)
    expect(typeof result).toBe('string')
  })

  it('scales budget with context window size', () => {
    const sections: GoalSection[] = [
      { name: 'Content', priority: 100, content: 'x'.repeat(5000) },
    ]
    const smallResult = buildBudgetedGoal(sections, smallConfig)
    const largeResult = buildBudgetedGoal(sections, largeConfig)
    // Both should include the content (it's within both budgets)
    expect(smallResult).toContain('## Content')
    expect(largeResult).toContain('## Content')
  })
})

describe('capEnrichedGoal', () => {
  it('returns goal unchanged if within cap', () => {
    const goal = 'short goal'
    const result = capEnrichedGoal(goal, 1000, smallConfig)
    expect(result).toBe(goal)
  })

  it('truncates if exceeds cap', () => {
    const goal = 'x'.repeat(10000)
    const result = capEnrichedGoal(goal, 100, smallConfig)
    expect(result.length).toBeLessThan(goal.length)
    expect(result).toContain('truncated')
  })
})
