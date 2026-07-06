import { describe, it, expect } from 'vitest'
import { TokenBudgetTracker } from '../../src/models/token-budget-tracker'

describe('TokenBudgetTracker', () => {
  it('tracks usage correctly', () => {
    const tracker = new TokenBudgetTracker(10000, 10)
    tracker.recordUsage(100, 50)

    const status = tracker.getStatus()
    expect(status.usedTokens).toBe(150)
    expect(status.usedModelCalls).toBe(1)
    expect(status.isOverBudget).toBe(false)
  })

  it('detects over-budget on tokens', () => {
    const tracker = new TokenBudgetTracker(200, 10)
    tracker.recordUsage(100, 50)
    tracker.recordUsage(100, 50)

    expect(tracker.isOverBudget()).toBe(true)
  })

  it('detects over-budget on model calls', () => {
    const tracker = new TokenBudgetTracker(10000, 2)
    tracker.recordUsage(100, 50)
    tracker.recordUsage(100, 50)

    expect(tracker.isOverBudget()).toBe(true)
  })

  it('hard enforcement throws on over-budget', () => {
    const tracker = new TokenBudgetTracker(100, 10, 'hard')
    tracker.recordUsage(50, 30) // 80 used, still under

    expect(() => tracker.recordUsage(20, 10)).toThrow('Budget exceeded') // 110 > 100
  })

  it('soft enforcement returns false on over-budget', () => {
    const tracker = new TokenBudgetTracker(100, 10, 'soft')
    tracker.recordUsage(60, 40) // Exactly at budget

    const ok = tracker.recordUsage(10, 10)
    expect(ok).toBe(false)
  })

  it('warn enforcement returns true even when over-budget', () => {
    const tracker = new TokenBudgetTracker(100, 10, 'warn')
    tracker.recordUsage(60, 40)

    const ok = tracker.recordUsage(10, 10)
    expect(ok).toBe(true)
  })

  it('isNearBudget detects approaching limit', () => {
    const tracker = new TokenBudgetTracker(1000, 10)
    tracker.recordUsage(850, 0) // 85% used

    expect(tracker.isNearBudget()).toBe(true) // default 20% threshold: 85% >= 80%
    expect(tracker.isNearBudget(0.2)).toBe(true) // 85% >= 80%
    expect(tracker.isNearBudget(0.1)).toBe(false) // 85% < 90%
  })

  it('getRemaining returns correct values', () => {
    const tracker = new TokenBudgetTracker(1000, 10)
    tracker.recordUsage(300, 100)

    const remaining = tracker.getRemaining()
    expect(remaining.tokens).toBe(600)
    expect(remaining.calls).toBe(9)
  })

  it('toInstructionBlock generates readable text', () => {
    const tracker = new TokenBudgetTracker(50000, 15)
    tracker.recordUsage(10000, 5000)

    const block = tracker.toInstructionBlock()
    expect(block).toContain('Token Budget')
    expect(block).toContain('15,000 tokens')
    expect(block).toContain('1 calls')
  })

  it('toInstructionBlock shows warning when near budget', () => {
    const tracker = new TokenBudgetTracker(1000, 5)
    tracker.recordUsage(900, 0) // 90% used

    const block = tracker.toInstructionBlock()
    expect(block).toContain('Budget is low')
  })

  it('resets correctly', () => {
    const tracker = new TokenBudgetTracker(1000, 10)
    tracker.recordUsage(500, 200)
    tracker.reset()

    const status = tracker.getStatus()
    expect(status.usedTokens).toBe(0)
    expect(status.usedModelCalls).toBe(0)
    expect(status.isOverBudget).toBe(false)
  })

  it('handles Infinity budget', () => {
    const tracker = new TokenBudgetTracker(Infinity, Infinity)
    tracker.recordUsage(100000, 50000)

    expect(tracker.isOverBudget()).toBe(false)
    expect(tracker.getRemaining().tokens).toBeGreaterThan(0)
  })
})
