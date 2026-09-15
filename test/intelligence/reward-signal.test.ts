import { describe, it, expect, beforeEach } from 'vitest'
import { RewardSignalManager } from '../../src/intelligence/reward-signal'

describe('RewardSignalManager', () => {
  let manager: RewardSignalManager

  beforeEach(() => {
    manager = new RewardSignalManager()
  })

  it('records a reward', () => {
    const r = manager.record('httpRequest', 1, 'confirmed finding', 'SQLi', '/api/users')
    expect(r.toolName).toBe('httpRequest')
    expect(r.score).toBe(1)
  })

  it('computes summary for a tool', () => {
    manager.record('httpRequest', 1, 'finding')
    manager.record('httpRequest', 0, 'neutral')
    manager.record('httpRequest', -1, 'error')

    const summary = manager.getSummary('httpRequest')
    expect(summary.totalRewards).toBe(3)
    expect(summary.positiveCount).toBe(1)
    expect(summary.neutralCount).toBe(1)
    expect(summary.negativeCount).toBe(1)
    expect(summary.averageScore).toBeCloseTo(0, 5)
    expect(summary.successRate).toBeCloseTo(1 / 3, 5)
  })

  it('returns zero for unknown tool', () => {
    const summary = manager.getSummary('nonexistent')
    expect(summary.totalRewards).toBe(0)
    expect(summary.successRate).toBe(0)
  })

  it('gets all summaries', () => {
    manager.record('httpRequest', 1, 'ok')
    manager.record('queryGraph', 0, 'neutral')
    const summaries = manager.getAllSummaries()
    expect(summaries).toHaveLength(2)
  })

  it('gets recent rewards', () => {
    for (let i = 0; i < 15; i++) {
      manager.record('httpRequest', 0, `call ${i}`)
    }
    expect(manager.getRecent(5)).toHaveLength(5)
    expect(manager.getRecent(5)[0].reason).toBe('call 10')
  })

  it('clears all rewards', () => {
    manager.record('httpRequest', 1, 'finding')
    manager.clear()
    expect(manager.getAll()).toHaveLength(0)
  })
})
