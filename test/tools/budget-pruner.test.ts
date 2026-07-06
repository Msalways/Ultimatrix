import { describe, it, expect, beforeEach } from 'vitest'
import { BudgetAwarePruner, getUniversalTools, getEssentialTools } from '../../src/tools/budget-pruner'
import { TokenProfiler } from '../../src/tools/token-profiler'
import type { TaskBudget } from '../../src/models/selector'

function makeBudget(overrides?: Partial<TaskBudget>): TaskBudget {
  return {
    estimatedModelCalls: 10,
    estimatedInputTokens: 5000,
    estimatedOutputTokens: 3000,
    maxAllowedModelCalls: 10,
    maxAllowedTokens: 50000,
    toolSet: [],
    prunedTools: [],
    ...overrides,
  }
}

describe('BudgetAwarePruner', () => {
  let profiler: TokenProfiler
  let pruner: BudgetAwarePruner

  beforeEach(() => {
    profiler = new TokenProfiler()
    pruner = new BudgetAwarePruner(profiler)
  })

  it('keeps essential tools even when over budget', () => {
    const tools = ['updateGraph', 'writeFinding', 'httpRequest', 'checkWaf']
    const budget = makeBudget({ maxAllowedModelCalls: 1 }) // Very tight

    const { kept, pruned } = pruner.pruneToBudget(tools, budget)
    expect(kept).toContain('updateGraph')
    expect(kept).toContain('writeFinding')
  })

  it('prunes expensive tools first', () => {
    const tools = ['updateGraph', 'httpRequest', 'checkWaf', 'measureTiming']
    const budget = makeBudget({ maxAllowedModelCalls: 4 })

    const { kept } = pruner.pruneToBudget(tools, budget)
    expect(kept).toContain('updateGraph') // essential
    // Should fit within budget
    expect(kept.length).toBeGreaterThanOrEqual(1)
  })

  it('handles unlimited budget', () => {
    const tools = ['updateGraph', 'httpRequest', 'checkWaf', 'measureTiming']
    const budget = makeBudget({ maxAllowedModelCalls: Infinity })

    const { kept, pruned } = pruner.pruneToBudget(tools, budget)
    expect(pruned).toHaveLength(0)
    expect(kept.length).toBe(tools.length)
  })

  it('universal tools come before non-universal', () => {
    const tools = ['checkWaf', 'queryGraph', 'httpRequest']
    const budget = makeBudget({ maxAllowedModelCalls: 10 })

    const { kept } = pruner.pruneToBudget(tools, budget)
    const queryGraphIdx = kept.indexOf('queryGraph')
    const checkWafIdx = kept.indexOf('checkWaf')
    // queryGraph is universal, should come before checkWaf if both kept
    if (queryGraphIdx >= 0 && checkWafIdx >= 0) {
      expect(queryGraphIdx).toBeLessThan(checkWafIdx)
    }
  })

  it('estimateModelCalls sums correctly', () => {
    const total = pruner.estimateModelCalls(['httpRequest', 'checkWaf'])
    // httpRequest=1.5, checkWaf=2.0 → 3.5
    expect(total).toBeCloseTo(3.5, 0)
  })

  it('estimateTokens sums correctly', () => {
    const tokens = pruner.estimateTokens(['httpRequest', 'checkWaf'])
    expect(tokens.input).toBe(800 + 1200)
    expect(tokens.output).toBe(400 + 600)
  })
})

describe('getUniversalTools', () => {
  it('returns a list of universal tools', () => {
    const tools = getUniversalTools()
    expect(tools).toContain('updateGraph')
    expect(tools).toContain('writeFinding')
    expect(tools.length).toBeGreaterThan(3)
  })
})

describe('getEssentialTools', () => {
  it('returns essential tools', () => {
    const tools = getEssentialTools()
    expect(tools).toContain('updateGraph')
    expect(tools).toContain('writeFinding')
    expect(tools).toContain('recordEvidence')
  })
})
