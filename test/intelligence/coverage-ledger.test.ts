/**
 * Tests for Coverage Ledger (Phase G: persistent coverage tracking)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SkillContract } from '../../src/solver/skills/loader'

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: vi.fn(() => ({})),
}))

import {
  initCoverage,
  markStageExecuted,
  markStageCovered,
  markStageSkipped,
  getCoverageStatus,
  getUncoveredStages,
  coverageSummary,
  clearCoverage,
} from '../../src/intelligence/coverage-ledger'

const TEST_CONTRACT: SkillContract = {
  capabilities: ['network.request', 'response.compare'],
  procedure: [
    { id: 'baseline', goal: 'Capture owner behavior' },
    { id: 'alternate-actor', goal: 'Replay under different actor' },
    { id: 'compare', goal: 'Compare observations' },
    { id: 'reproduce', goal: 'Reproduce exploit' },
  ],
  coverage: [
    { id: 'owner-baseline', required: true },
    { id: 'alternate-actor', required: true },
  ],
  output: { schema: 'AuthorizationConclusion' },
}

describe('Coverage Ledger', () => {
  beforeEach(() => {
    clearCoverage()
  })

  describe('initCoverage()', () => {
    it('initializes coverage from contract', () => {
      const coverage = initCoverage('authorization', TEST_CONTRACT)
      expect(coverage.skillId).toBe('authorization')
      expect(coverage.stages).toHaveLength(4)
      expect(coverage.totalStages).toBe(4)
      expect(coverage.coveredStages).toBe(0)
      expect(coverage.complete).toBe(false)
    })

    it('each stage starts as pending', () => {
      const coverage = initCoverage('authorization', TEST_CONTRACT)
      for (const stage of coverage.stages) {
        expect(stage.status).toBe('pending')
        expect(stage.exchangeIds).toHaveLength(0)
        expect(stage.findingIds).toHaveLength(0)
      }
    })

    it('is idempotent — second call returns existing', () => {
      const c1 = initCoverage('authorization', TEST_CONTRACT)
      const c2 = initCoverage('authorization', TEST_CONTRACT)
      expect(c1).toBe(c2) // same reference
    })
  })

  describe('markStageExecuted()', () => {
    it('marks stage as executed', () => {
      initCoverage('authorization', TEST_CONTRACT)
      const result = markStageExecuted('authorization', 'baseline')
      expect(result).toBeDefined()
      const stage = result!.stages.find(s => s.stageId === 'baseline')!
      expect(stage.status).toBe('executed')
      expect(stage.executedAt).toBeGreaterThan(0)
    })

    it('attaches exchange ID', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageExecuted('authorization', 'baseline', 'ex-abc')
      const coverage = getCoverageStatus('authorization')!
      const stage = coverage.stages.find(s => s.stageId === 'baseline')!
      expect(stage.exchangeIds).toContain('ex-abc')
    })

    it('does not downgrade covered back to executed', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-1')
      markStageExecuted('authorization', 'baseline')
      const coverage = getCoverageStatus('authorization')!
      const stage = coverage.stages.find(s => s.stageId === 'baseline')!
      expect(stage.status).toBe('covered')
    })

    it('returns undefined for unknown skill', () => {
      expect(markStageExecuted('nonexistent', 'baseline')).toBeUndefined()
    })

    it('returns undefined for unknown stage', () => {
      initCoverage('authorization', TEST_CONTRACT)
      expect(markStageExecuted('authorization', 'nonexistent')).toBeUndefined()
    })
  })

  describe('markStageCovered()', () => {
    it('marks stage as covered with finding', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-finding-1')
      const coverage = getCoverageStatus('authorization')!
      const stage = coverage.stages.find(s => s.stageId === 'baseline')!
      expect(stage.status).toBe('covered')
      expect(stage.findingIds).toContain('ev-finding-1')
      expect(stage.coveredAt).toBeGreaterThan(0)
    })

    it('updates covered count', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-1')
      markStageCovered('authorization', 'compare', 'ev-2')
      const coverage = getCoverageStatus('authorization')!
      expect(coverage.coveredStages).toBe(2)
    })

    it('detects completion when all stages covered or skipped', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-1')
      markStageCovered('authorization', 'alternate-actor', 'ev-2')
      markStageSkipped('authorization', 'compare')
      markStageCovered('authorization', 'reproduce', 'ev-3')
      const coverage = getCoverageStatus('authorization')!
      expect(coverage.complete).toBe(true)
      expect(coverage.coveredStages).toBe(4)
    })
  })

  describe('markStageSkipped()', () => {
    it('marks stage as skipped', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageSkipped('authorization', 'compare')
      const coverage = getCoverageStatus('authorization')!
      const stage = coverage.stages.find(s => s.stageId === 'compare')!
      expect(stage.status).toBe('skipped')
    })

    it('skipped counts toward completion', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-1')
      markStageCovered('authorization', 'alternate-actor', 'ev-2')
      markStageSkipped('authorization', 'compare')
      markStageSkipped('authorization', 'reproduce')
      const coverage = getCoverageStatus('authorization')!
      expect(coverage.complete).toBe(true)
    })
  })

  describe('getUncoveredStages()', () => {
    it('returns pending and executed stages', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageExecuted('authorization', 'baseline')
      markStageCovered('authorization', 'alternate-actor', 'ev-1')
      markStageSkipped('authorization', 'compare')

      const uncovered = getUncoveredStages('authorization')
      expect(uncovered.map(s => s.stageId)).toEqual(['baseline', 'reproduce'])
    })

    it('returns empty for complete coverage', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-1')
      markStageCovered('authorization', 'alternate-actor', 'ev-2')
      markStageCovered('authorization', 'compare', 'ev-3')
      markStageCovered('authorization', 'reproduce', 'ev-4')

      expect(getUncoveredStages('authorization')).toHaveLength(0)
    })
  })

  describe('coverageSummary()', () => {
    it('generates readable summary', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-1')
      markStageExecuted('authorization', 'alternate-actor')

      const summary = coverageSummary('authorization')
      expect(summary).toContain('authorization')
      expect(summary).toContain('1/4 stages covered')
      expect(summary).toContain('✓ baseline')
      expect(summary).toContain('○ alternate-actor')
      expect(summary).toContain('Still pending: compare, reproduce')
    })

    it('returns message for unknown skill', () => {
      expect(coverageSummary('nonexistent')).toContain('No coverage data')
    })
  })

  describe('clearCoverage()', () => {
    it('removes all coverage data', () => {
      initCoverage('authorization', TEST_CONTRACT)
      markStageCovered('authorization', 'baseline', 'ev-1')
      clearCoverage()
      expect(getCoverageStatus('authorization')).toBeUndefined()
    })
  })
})
