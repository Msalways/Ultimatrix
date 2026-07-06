import { describe, it, expect, beforeEach } from 'vitest'
import { QuotaTracker, getGlobalQuotaTracker, resetGlobalQuotaTracker } from '../../src/models/quota-tracker'

describe('QuotaTracker', () => {
  let tracker: QuotaTracker

  beforeEach(() => {
    tracker = new QuotaTracker()
  })

  it('records requests', () => {
    tracker.recordRequest('groq')
    tracker.recordRequest('groq')
    tracker.recordRequest('openai')

    const status = tracker.getStatus()
    expect(status['groq'].used).toBe(2)
    expect(status['openai'].used).toBe(1)
  })

  it('records exhaustion with cooldown', () => {
    tracker.recordExhaustion('groq', 5000)

    expect(tracker.isExhausted('groq')).toBe(true)
    expect(tracker.isExhausted('openai')).toBe(false)
  })

  it('isExhausted returns false for unknown provider', () => {
    expect(tracker.isExhausted('unknown')).toBe(false)
  })

  it('exhaustion count increments', () => {
    tracker.recordExhaustion('groq', 1000)
    tracker.recordExhaustion('groq', 2000)

    const status = tracker.getStatus()
    expect(status['groq'].exhaustionCount).toBe(2)
    expect(status['groq'].lastExhaustion).toBeGreaterThan(0)
  })

  it('resetExhaustion clears cooldown', () => {
    tracker.recordExhaustion('groq', 60000)
    expect(tracker.isExhausted('groq')).toBe(true)

    tracker.resetExhaustion('groq')
    expect(tracker.isExhausted('groq')).toBe(false)
  })

  it('updateLimit stores provider limit', () => {
    tracker.updateLimit('groq', 100, 1720000000)

    const status = tracker.getStatus()
    expect(status['groq'].limit).toBe(100)
    expect(status['groq'].resetTime).toBe(1720000000)
  })

  it('reset clears all providers', () => {
    tracker.recordRequest('groq')
    tracker.recordRequest('openai')
    tracker.reset()

    const status = tracker.getStatus()
    expect(Object.keys(status)).toHaveLength(0)
  })

  it('global tracker is a singleton', () => {
    const a = getGlobalQuotaTracker()
    const b = getGlobalQuotaTracker()
    expect(a).toBe(b)
    resetGlobalQuotaTracker()
  })
})
