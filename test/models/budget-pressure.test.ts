import { describe, it, expect } from 'vitest'
import { getPressureLevel, describePressure, isCapabilityAllowed } from '../../src/models/budget-pressure'

describe('BudgetPressure', () => {
  describe('getPressureLevel', () => {
    it('returns normal below 80%', () => {
      expect(getPressureLevel(0.5)).toBe('normal')
      expect(getPressureLevel(0.79)).toBe('normal')
    })

    it('returns elevated at 80-95%', () => {
      expect(getPressureLevel(0.80)).toBe('elevated')
      expect(getPressureLevel(0.90)).toBe('elevated')
      expect(getPressureLevel(0.94)).toBe('elevated')
    })

    it('returns critical at 95%+', () => {
      expect(getPressureLevel(0.95)).toBe('critical')
      expect(getPressureLevel(1.0)).toBe('critical')
      expect(getPressureLevel(1.5)).toBe('critical')
    })

    it('respects custom thresholds', () => {
      expect(getPressureLevel(0.60, { elevatedThreshold: 0.50 })).toBe('elevated')
      expect(getPressureLevel(0.80, { criticalThreshold: 0.75 })).toBe('critical')
    })
  })

  describe('describePressure', () => {
    it('describes normal', () => {
      expect(describePressure('normal')).toContain('Full capabilities')
    })

    it('describes elevated', () => {
      expect(describePressure('elevated')).toContain('skipping exploitation loop')
    })

    it('describes critical', () => {
      expect(describePressure('critical')).toContain('core tools only')
    })
  })

  describe('isCapabilityAllowed', () => {
    it('allows everything at normal', () => {
      expect(isCapabilityAllowed('normal', 'exploitation_loop')).toBe(true)
      expect(isCapabilityAllowed('normal', 'council')).toBe(true)
      expect(isCapabilityAllowed('normal', 'core_tools')).toBe(true)
    })

    it('restricts at elevated', () => {
      expect(isCapabilityAllowed('elevated', 'exploitation_loop')).toBe(false)
      expect(isCapabilityAllowed('elevated', 'council')).toBe(false)
      expect(isCapabilityAllowed('elevated', 'core_tools')).toBe(true)
    })

    it('restricts at critical', () => {
      expect(isCapabilityAllowed('critical', 'exploitation_loop')).toBe(false)
      expect(isCapabilityAllowed('critical', 'worker_spawning')).toBe(false)
      expect(isCapabilityAllowed('critical', 'core_tools')).toBe(true)
    })
  })
})
