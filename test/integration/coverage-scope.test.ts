/**
 * Tests for Coverage Scope Isolation (Phase 1).
 * Verifies that parallel tasks using the same skill maintain
 * completely separate coverage state.
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
  type CoverageScope,
} from '../../src/intelligence/coverage-ledger'

const AUTH_CONTRACT: SkillContract = {
  capabilities: ['network.request'],
  procedure: [
    { id: 'baseline', goal: 'Capture owner behavior' },
    { id: 'alternate-actor', goal: 'Replay under different actor' },
    { id: 'compare', goal: 'Compare observations' },
  ],
  coverage: [{ id: 'owner-baseline', required: true }],
  output: { schema: 'AuthorizationConclusion' },
}

describe('Coverage Scope Isolation', () => {
  beforeEach(() => {
    clearCoverage()
  })

  it('two tasks using the same skill maintain separate coverage', () => {
    const scopeA: CoverageScope = { runId: 'run-1', taskId: 'task-A', skillId: 'authorization' }
    const scopeB: CoverageScope = { runId: 'run-1', taskId: 'task-B', skillId: 'authorization' }

    // Initialize both
    initCoverage(scopeA, AUTH_CONTRACT)
    initCoverage(scopeB, AUTH_CONTRACT)

    // Task A covers baseline
    markStageCovered(scopeA, 'baseline', 'finding-A1')

    // Task B covers alternate-actor
    markStageCovered(scopeB, 'alternate-actor', 'finding-B1')

    // Verify isolation
    const covA = getCoverageStatus(scopeA)!
    const covB = getCoverageStatus(scopeB)!

    expect(covA.coveredStages).toBe(1)
    expect(covA.stages.find(s => s.stageId === 'baseline')!.status).toBe('covered')
    expect(covA.stages.find(s => s.stageId === 'alternate-actor')!.status).toBe('pending')

    expect(covB.coveredStages).toBe(1)
    expect(covB.stages.find(s => s.stageId === 'baseline')!.status).toBe('pending')
    expect(covB.stages.find(s => s.stageId === 'alternate-actor')!.status).toBe('covered')
  })

  it('cross-task coverage leakage is impossible', () => {
    const scopeA: CoverageScope = { runId: 'run-1', taskId: 'task-A', skillId: 'authorization' }
    const scopeB: CoverageScope = { runId: 'run-1', taskId: 'task-B', skillId: 'authorization' }

    initCoverage(scopeA, AUTH_CONTRACT)
    initCoverage(scopeB, AUTH_CONTRACT)

    // Complete task A
    markStageCovered(scopeA, 'baseline', 'f1')
    markStageCovered(scopeA, 'alternate-actor', 'f2')
    markStageCovered(scopeA, 'compare', 'f3')

    // Task B should still be empty
    const covB = getCoverageStatus(scopeB)!
    expect(covB.coveredStages).toBe(0)
    expect(covB.complete).toBe(false)
  })

  it('coverage survives scope-keyed lookups', () => {
    const scope: CoverageScope = { runId: 'run-42', taskId: 'task-99', skillId: 'injection' }

    initCoverage(scope, AUTH_CONTRACT)
    markStageExecuted(scope, 'baseline', 'ex-1')
    markStageCovered(scope, 'baseline', 'f-1')

    const coverage = getCoverageStatus(scope)
    expect(coverage).toBeDefined()
    expect(coverage!.scope.runId).toBe('run-42')
    expect(coverage!.scope.taskId).toBe('task-99')
  })

  it('event replay reconstructs coverage state', () => {
    const scope: CoverageScope = { runId: 'run-1', taskId: 'task-1', skillId: 'authorization' }

    initCoverage(scope, AUTH_CONTRACT)
    markStageExecuted(scope, 'baseline', 'ex-1')
    markStageCovered(scope, 'baseline', 'f-1')
    markStageSkipped(scope, 'compare', 'not applicable')

    const events = getCoverageEvents(scope)
    expect(events).toHaveLength(3)
    expect(events[0].type).toBe('stage.executed')
    expect(events[1].type).toBe('stage.covered')
    expect(events[2].type).toBe('stage.skipped')
  })

  it('different runs with same skill are isolated', () => {
    const scopeA: CoverageScope = { runId: 'run-1', taskId: 'task-1', skillId: 'auth' }
    const scopeB: CoverageScope = { runId: 'run-2', taskId: 'task-1', skillId: 'auth' }

    initCoverage(scopeA, AUTH_CONTRACT)
    initCoverage(scopeB, AUTH_CONTRACT)

    markStageCovered(scopeA, 'baseline', 'f1')

    expect(getCoverageStatus(scopeA)!.coveredStages).toBe(1)
    expect(getCoverageStatus(scopeB)!.coveredStages).toBe(0)
  })

  it('summary includes scope information', () => {
    const scope: CoverageScope = { runId: 'run-1', taskId: 'task-1', skillId: 'authorization' }
    initCoverage(scope, AUTH_CONTRACT)
    markStageCovered(scope, 'baseline', 'f-1')

    const summary = coverageSummary(scope)
    expect(summary).toContain('run=run-1')
    expect(summary).toContain('task=task-1')
  })
})
