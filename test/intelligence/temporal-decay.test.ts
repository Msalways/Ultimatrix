import { describe, it, expect } from 'vitest'
import { applyDecay, applyDecayToMap, halfLifeDays, decayFactor } from '../../src/intelligence/temporal-decay'

describe('TemporalDecay', () => {
  const NOW = new Date('2026-09-13T12:00:00Z')

  describe('applyDecay', () => {
    it('returns full weight for same timestamp', () => {
      const result = applyDecay(1.0, NOW.toISOString(), {}, NOW)
      expect(result).toBeCloseTo(1.0, 5)
    })

    it('reduces weight over time', () => {
      const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const result = applyDecay(1.0, tenDaysAgo, {}, NOW)
      expect(result).toBeLessThan(1.0)
      expect(result).toBeGreaterThan(0.5) // 10 days shouldn't decay much
    })

    it('decays to near zero after 100 days', () => {
      const hundredDaysAgo = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString()
      const result = applyDecay(1.0, hundredDaysAgo, {}, NOW)
      expect(result).toBeLessThan(0.4)
    })

    it('returns 0 below minimum weight', () => {
      const veryOld = new Date(NOW.getTime() - 500 * 24 * 60 * 60 * 1000).toISOString()
      const result = applyDecay(1.0, veryOld, {}, NOW)
      expect(result).toBe(0)
    })

    it('respects custom lambda (faster decay)', () => {
      const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const result = applyDecay(1.0, tenDaysAgo, { lambda: 0.1 }, NOW)
      expect(result).toBeLessThan(0.5) // Higher lambda = faster decay
    })

    it('respects custom lambda (slower decay)', () => {
      const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const result = applyDecay(1.0, tenDaysAgo, { lambda: 0.001 }, NOW)
      expect(result).toBeGreaterThan(0.95) // Lower lambda = slower decay
    })

    it('handles zero weight', () => {
      const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const result = applyDecay(0, tenDaysAgo, {}, NOW)
      expect(result).toBe(0)
    })

    it('handles future timestamps gracefully', () => {
      const future = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString()
      const result = applyDecay(1.0, future, {}, NOW)
      // Future timestamps result in negative days → exp(negative) > 1, but we cap at weight
      expect(result).toBeGreaterThanOrEqual(1.0)
    })
  })

  describe('applyDecayToMap', () => {
    it('applies decay to all items', () => {
      const map = new Map([
        ['a', { weight: 1.0, lastUpdated: new Date(NOW.getTime() - 10 * 86400000).toISOString() }],
        ['b', { weight: 0.5, lastUpdated: new Date(NOW.getTime() - 50 * 86400000).toISOString() }],
      ])

      const result = applyDecayToMap(map, {}, NOW)
      expect(result.size).toBe(2)
      expect(result.get('a')!.decayedWeight).toBeGreaterThan(result.get('b')!.decayedWeight)
    })

    it('removes items below threshold', () => {
      const map = new Map([
        ['recent', { weight: 1.0, lastUpdated: new Date(NOW.getTime() - 5 * 86400000).toISOString() }],
        ['very_old', { weight: 0.1, lastUpdated: new Date(NOW.getTime() - 500 * 86400000).toISOString() }],
      ])

      const result = applyDecayToMap(map, {}, NOW)
      expect(result.has('recent')).toBe(true)
      expect(result.has('very_old')).toBe(false)
    })

    it('returns empty map for all-old items', () => {
      const map = new Map([
        ['a', { weight: 0.1, lastUpdated: new Date(NOW.getTime() - 500 * 86400000).toISOString() }],
      ])

      const result = applyDecayToMap(map, {}, NOW)
      expect(result.size).toBe(0)
    })
  })

  describe('halfLifeDays', () => {
    it('returns ~69.3 days for default lambda (0.01)', () => {
      expect(halfLifeDays()).toBeCloseTo(69.3, 0)
    })

    it('returns ~6.9 days for lambda=0.1', () => {
      expect(halfLifeDays(0.1)).toBeCloseTo(6.9, 0)
    })
  })

  describe('decayFactor', () => {
    it('returns 1.0 for 0 days', () => {
      expect(decayFactor(0)).toBeCloseTo(1.0, 5)
    })

    it('returns ~0.5 for 69.3 days (default half-life)', () => {
      expect(decayFactor(69.3)).toBeCloseTo(0.5, 1)
    })

    it('returns ~0.25 for 2 half-lives', () => {
      expect(decayFactor(2 * 69.3)).toBeCloseTo(0.25, 1)
    })
  })
})
