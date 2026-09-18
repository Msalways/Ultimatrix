/**
 * Tests for Coverage Ledger (Phase G + Phase 1: scope-based coverage)
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
  getCoverageEvents,
  initCoverageLegacy,
  type CoverageScope,
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

const DEFAULT_SCOPE: CoverageScope = { runId: 'run-1', taskId: 'task-1', skillId: 'authorization' }

describe('Coverage Ledger', () => {
  beforeEach(() => {
    clearCoverage()
  })

  describe('initCoverage()', () => {
    it('initializes coverage from contract with scope', () => {
      const coverage = initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      expect(coverage.scope).toEqual(DEFAULT_SCOPE)
      expect(coverage.stages).toHaveLength(4)
      expect(coverage.totalStages).toBe(4)
      expect(coverage.coveredStages).toBe(0)
      expect(coverage.complete).toBe(false)
    })

    it('each stage starts as pending', () => {
      const coverage = initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      for (const stage of coverage.stages) {
        expect(stage.status).toBe('pending')
        expect(stage.exchangeIds).toHaveLength(0)
        expect(stage.findingIds).toHaveLength(0)
      }
    })

    it('is idempotent — second call returns existing', () => {
      const c1 = initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      const c2 = initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      expect(c1).toBe(c2)
    })

    it('legacy init works with just skillId', () => {
      const coverage = initCoverageLegacy('authorization', TEST_CONTRACT)
      expect(coverage.scope).toEqual({ runId: 'default', taskId: 'default', skillId: 'authorization' })
    })
  })

  describe('markStageExecuted()', () => {
    it('marks stage as executed', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      const result = markStageExecuted(DEFAULT_SCOPE, 'baseline')
      expect(result).toBeDefined()
      const stage = result!.stages.find(s => s.stageId === 'baseline')!
      expect(stage.status).toBe('executed')
      expect(stage.executedAt).toBeGreaterThan(0)
    })

    it('attaches exchange ID', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageExecuted(DEFAULT_SCOPE, 'baseline', 'ex-abc')
      const coverage = getCoverageStatus(DEFAULT_SCOPE)!
      const stage = coverage.stages.find(s => s.stageId === 'baseline')!
      expect(stage.exchangeIds).toContain('ex-abc')
    })

    it('does not downgrade covered back to executed', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-1')
      markStageExecuted(DEFAULT_SCOPE, 'baseline')
      const coverage = getCoverageStatus(DEFAULT_SCOPE)!
      const stage = coverage.stages.find(s => s.stageId === 'baseline')!
      expect(stage.status).toBe('covered')
    })

    it('returns undefined for unknown skill', () => {
      expect(markStageExecuted({ runId: 'r', taskId: 't', skillId: 'nonexistent' }, 'baseline')).toBeUndefined()
    })

    it('returns undefined for unknown stage', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      expect(markStageExecuted(DEFAULT_SCOPE, 'nonexistent')).toBeUndefined()
    })

    it('records event in event log', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageExecuted(DEFAULT_SCOPE, 'baseline', 'ex-1')
      const events = getCoverageEvents(DEFAULT_SCOPE)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('stage.executed')
      expect(events[0].stageId).toBe('baseline')
      expect(events[0].ref).toBe('ex-1')
    })
  })

  describe('markStageCovered()', () => {
    it('marks stage as covered with finding', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-finding-1')
      const coverage = getCoverageStatus(DEFAULT_SCOPE)!
      const stage = coverage.stages.find(s => s.stageId === 'baseline')!
      expect(stage.status).toBe('covered')
      expect(stage.findingIds).toContain('ev-finding-1')
      expect(stage.coveredAt).toBeGreaterThan(0)
    })

    it('updates covered count', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-1')
      markStageCovered(DEFAULT_SCOPE, 'compare', 'ev-2')
      const coverage = getCoverageStatus(DEFAULT_SCOPE)!
      expect(coverage.coveredStages).toBe(2)
    })

    it('detects completion when all stages covered or skipped', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-1')
      markStageCovered(DEFAULT_SCOPE, 'alternate-actor', 'ev-2')
      markStageSkipped(DEFAULT_SCOPE, 'compare')
      markStageCovered(DEFAULT_SCOPE, 'reproduce', 'ev-3')
      const coverage = getCoverageStatus(DEFAULT_SCOPE)!
      expect(coverage.complete).toBe(true)
      expect(coverage.coveredStages).toBe(4)
    })
  })

  describe('markStageSkipped()', () => {
    it('marks stage as skipped', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageSkipped(DEFAULT_SCOPE, 'compare')
      const coverage = getCoverageStatus(DEFAULT_SCOPE)!
      const stage = coverage.stages.find(s => s.stageId === 'compare')!
      expect(stage.status).toBe('skipped')
    })

    it('skipped counts toward completion', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-1')
      markStageCovered(DEFAULT_SCOPE, 'alternate-actor', 'ev-2')
      markStageSkipped(DEFAULT_SCOPE, 'compare')
      markStageSkipped(DEFAULT_SCOPE, 'reproduce')
      const coverage = getCoverageStatus(DEFAULT_SCOPE)!
      expect(coverage.complete).toBe(true)
    })
  })

  describe('getUncoveredStages()', () => {
    it('returns pending and executed stages', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageExecuted(DEFAULT_SCOPE, 'baseline')
      markStageCovered(DEFAULT_SCOPE, 'alternate-actor', 'ev-1')
      markStageSkipped(DEFAULT_SCOPE, 'compare')

      const uncovered = getUncoveredStages(DEFAULT_SCOPE)
      expect(uncovered.map(s => s.stageId)).toEqual(['baseline', 'reproduce'])
    })

    it('returns empty for complete coverage', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-1')
      markStageCovered(DEFAULT_SCOPE, 'alternate-actor', 'ev-2')
      markStageCovered(DEFAULT_SCOPE, 'compare', 'ev-3')
      markStageCovered(DEFAULT_SCOPE, 'reproduce', 'ev-4')

      expect(getUncoveredStages(DEFAULT_SCOPE)).toHaveLength(0)
    })
  })

  describe('coverageSummary()', () => {
    it('generates readable summary with scope', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-1')
      markStageExecuted(DEFAULT_SCOPE, 'alternate-actor')

      const summary = coverageSummary(DEFAULT_SCOPE)
      expect(summary).toContain('authorization')
      expect(summary).toContain('1/4 stages covered')
      expect(summary).toContain('✓ baseline')
      expect(summary).toContain('○ alternate-actor')
      expect(summary).toContain('Still pending: compare, reproduce')
    })

    it('returns message for unknown skill', () => {
      expect(coverageSummary({ runId: 'r', taskId: 't', skillId: 'nonexistent' })).toContain('No coverage data')
    })
  })

  describe('clearCoverage()', () => {
    it('removes all coverage data and events', () => {
      initCoverage(DEFAULT_SCOPE, TEST_CONTRACT)
      markStageCovered(DEFAULT_SCOPE, 'baseline', 'ev-1')
      clearCoverage()
      expect(getCoverageStatus(DEFAULT_SCOPE)).toBeUndefined()
      expect(getCoverageEvents(DEFAULT_SCOPE)).toHaveLength(0)
    })
  })
})
