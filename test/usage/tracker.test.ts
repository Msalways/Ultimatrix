import { describe, it, expect, beforeEach } from 'vitest'
import { UsageTracker } from '../../src/usage/tracker'

describe('UsageTracker', () => {
  let tracker: UsageTracker

  beforeEach(() => {
    tracker = new UsageTracker()
  })

  it('records entries with token breakdown', () => {
    tracker.record('groq', 'llama3-8b-8192', 100, 50)

    const total = tracker.getTotal()
    expect(total.inputTokens).toBe(100)
    expect(total.outputTokens).toBe(50)
    expect(total.totalTokens).toBe(150)
    expect(total.calls).toBe(1)
  })

  it('accumulates multiple entries', () => {
    tracker.record('groq', 'llama3-8b-8192', 100, 50)
    tracker.record('openai', 'gpt-4o', 200, 100)
    tracker.record('groq', 'llama3-8b-8192', 50, 25)

    const total = tracker.getTotal()
    expect(total.inputTokens).toBe(350)
    expect(total.outputTokens).toBe(175)
    expect(total.totalTokens).toBe(525)
    expect(total.calls).toBe(3)
  })

  it('groups by provider', () => {
    tracker.record('groq', 'llama3-8b-8192', 100, 50)
    tracker.record('openai', 'gpt-4o', 200, 100)
    tracker.record('groq', 'llama3-8b-8192', 50, 25)

    const byProvider = tracker.getByProvider()
    expect(Object.keys(byProvider)).toHaveLength(2)
    expect(byProvider['groq'].inputTokens).toBe(150)
    expect(byProvider['groq'].outputTokens).toBe(75)
    expect(byProvider['groq'].calls).toBe(2)
    expect(byProvider['openai'].inputTokens).toBe(200)
    expect(byProvider['openai'].calls).toBe(1)
  })

  it('resets all entries', () => {
    tracker.record('groq', 'llama3-8b-8192', 100, 50)
    tracker.reset()

    const total = tracker.getTotal()
    expect(total.totalTokens).toBe(0)
    expect(total.calls).toBe(0)
  })

  it('returns zero totals when empty', () => {
    const total = tracker.getTotal()
    expect(total.inputTokens).toBe(0)
    expect(total.outputTokens).toBe(0)
    expect(total.totalTokens).toBe(0)
    expect(total.calls).toBe(0)
  })

  it('handles zero tokens gracefully', () => {
    tracker.record('groq', 'llama3-8b-8192', 0, 0)

    const total = tracker.getTotal()
    expect(total.totalTokens).toBe(0)
    expect(total.calls).toBe(1)
  })

  it('records timestamp for each entry', () => {
    const before = Date.now()
    tracker.record('groq', 'llama3-8b-8192', 100, 50)
    const after = Date.now()

    const byProvider = tracker.getByProvider()
    expect(byProvider['groq'].calls).toBe(1)
  })

  it('printSummary does not throw on empty tracker', () => {
    expect(() => tracker.printSummary()).not.toThrow()
  })
})
