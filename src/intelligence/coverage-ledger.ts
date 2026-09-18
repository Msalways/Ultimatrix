/**
 * Coverage Ledger (Strix Adaptation Phase G + E2E Phase 1).
 *
 * Tracks which skill contract stages have been executed and which findings
 * cover each stage. The LLM can query coverage to know what's been tested
 * and what's still missing. Persists to the graph store.
 *
 * Phase 1: Coverage is keyed by runId+taskId+skillId (not just skillId).
 * Parallel tasks using the same skill maintain completely separate coverage.
 * Events are stored for replay/projection.
 */

import type { SkillContract, ProcedureStage } from '../solver/skills/loader'

export type StageStatus = 'pending' | 'executed' | 'covered' | 'skipped'

/** Coverage scope — uniquely identifies a coverage context */
export interface CoverageScope {
  runId: string
  taskId: string
  skillId: string
}

export interface StageCoverage {
  stageId: string
  goal: string
  status: StageStatus
  /** Exchange artifact IDs that cover this stage */
  exchangeIds: string[]
  /** Finding IDs that confirm this stage was satisfied */
  findingIds: string[]
  /** Timestamp when first executed */
  executedAt?: number
  /** Timestamp when covered by a finding */
  coveredAt?: number
}

export interface SkillCoverage {
  scope: CoverageScope
  stages: StageCoverage[]
  complete: boolean
  totalStages: number
  coveredStages: number
  lastUpdated: number
}

/** Coverage events for event-sourced projection */
export type CoverageEventType = 'stage.executed' | 'stage.covered' | 'stage.skipped'

export interface CoverageEvent {
  type: CoverageEventType
  scope: CoverageScope
  stageId: string
  timestamp: number
  ref?: string
}

/** Composite key for scope-based lookup */
function scopeKey(scope: CoverageScope): string {
  return `${scope.runId}:${scope.taskId}:${scope.skillId}`
}

/** Legacy key (backward compat) */
function legacyKey(skillId: string): string {
  return `default:default:${skillId}`
}

/** In-memory coverage state keyed by scope */
const coverageMap = new Map<string, SkillCoverage>()

/** Event log for replay/projection */
const eventLog: CoverageEvent[] = []

/**
 * Initialize coverage tracking for a skill from its contract.
 * Idempotent: calling again with the same scope doesn't overwrite existing state.
 */
export function initCoverage(scope: CoverageScope, contract: SkillContract): SkillCoverage {
  const key = scopeKey(scope)
  const existing = coverageMap.get(key)
  if (existing) return existing

  const stages: StageCoverage[] = contract.procedure.map(s => ({
    stageId: s.id,
    goal: s.goal,
    status: 'pending' as StageStatus,
    exchangeIds: [],
    findingIds: [],
  }))

  const coverage: SkillCoverage = {
    scope,
    stages,
    complete: false,
    totalStages: stages.length,
    coveredStages: 0,
    lastUpdated: Date.now(),
  }

  coverageMap.set(key, coverage)
  return coverage
}

/**
 * Mark a stage as executed (test was run against it).
 */
export function markStageExecuted(
  scope: CoverageScope,
  stageId: string,
  exchangeId?: string,
): SkillCoverage | undefined {
  const key = scopeKey(scope)
  const coverage = coverageMap.get(key)
  if (!coverage) return undefined

  const stage = coverage.stages.find(s => s.stageId === stageId)
  if (!stage) return undefined

  if (stage.status === 'pending') {
    stage.status = 'executed'
    stage.executedAt = Date.now()
  }
  if (exchangeId && !stage.exchangeIds.includes(exchangeId)) {
    stage.exchangeIds.push(exchangeId)
  }

  coverage.lastUpdated = Date.now()
  recalculate(coverage)

  // Record event
  eventLog.push({
    type: 'stage.executed',
    scope,
    stageId,
    timestamp: Date.now(),
    ref: exchangeId,
  })

  return coverage
}

/**
 * Mark a stage as covered (finding confirms it was tested successfully).
 */
export function markStageCovered(
  scope: CoverageScope,
  stageId: string,
  findingId: string,
): SkillCoverage | undefined {
  const key = scopeKey(scope)
  const coverage = coverageMap.get(key)
  if (!coverage) return undefined

  const stage = coverage.stages.find(s => s.stageId === stageId)
  if (!stage) return undefined

  stage.status = 'covered'
  stage.coveredAt = Date.now()
  if (!stage.findingIds.includes(findingId)) {
    stage.findingIds.push(findingId)
  }

  coverage.lastUpdated = Date.now()
  recalculate(coverage)

  // Record event
  eventLog.push({
    type: 'stage.covered',
    scope,
    stageId,
    timestamp: Date.now(),
    ref: findingId,
  })

  return coverage
}

/**
 * Skip a stage (not applicable for this target).
 */
export function markStageSkipped(
  scope: CoverageScope,
  stageId: string,
  reason?: string,
): SkillCoverage | undefined {
  const key = scopeKey(scope)
  const coverage = coverageMap.get(key)
  if (!coverage) return undefined

  const stage = coverage.stages.find(s => s.stageId === stageId)
  if (!stage) return undefined

  stage.status = 'skipped'
  coverage.lastUpdated = Date.now()
  recalculate(coverage)

  // Record event
  eventLog.push({
    type: 'stage.skipped',
    scope,
    stageId,
    timestamp: Date.now(),
    ref: reason,
  })

  return coverage
}

/**
 * Get the current coverage status for a scope.
 */
export function getCoverageStatus(scope: CoverageScope): SkillCoverage | undefined {
  return coverageMap.get(scopeKey(scope))
}

/**
 * Get uncovered stages for a scope — what still needs testing.
 */
export function getUncoveredStages(scope: CoverageScope): StageCoverage[] {
  const coverage = coverageMap.get(scopeKey(scope))
  if (!coverage) return []
  return coverage.stages.filter(s => s.status === 'pending' || s.status === 'executed')
}

/**
 * Get a summary string suitable for LLM context.
 */
export function coverageSummary(scope: CoverageScope): string {
  const coverage = coverageMap.get(scopeKey(scope))
  if (!coverage) return `No coverage data for ${scope.skillId} (run=${scope.runId}, task=${scope.taskId})`

  const lines = [`## Coverage: ${scope.skillId} (run=${scope.runId}, task=${scope.taskId})`]
  lines.push(`${coverage.coveredStages}/${coverage.totalStages} stages covered`)
  lines.push('')

  for (const stage of coverage.stages) {
    const icon = stage.status === 'covered' ? '✓' :
                 stage.status === 'executed' ? '○' :
                 stage.status === 'skipped' ? '–' : '·'
    const finding = stage.findingIds.length > 0 ? ` (${stage.findingIds[0]})` : ''
    lines.push(`  ${icon} ${stage.stageId}: ${stage.goal}${finding}`)
  }

  if (!coverage.complete) {
    const uncovered = coverage.stages.filter(s => s.status === 'pending')
    if (uncovered.length > 0) {
      lines.push('')
      lines.push(`Still pending: ${uncovered.map(s => s.stageId).join(', ')}`)
    }
  }

  return lines.join('\n')
}

/**
 * Get all coverage events for a scope (for replay).
 */
export function getCoverageEvents(scope: CoverageScope): CoverageEvent[] {
  return eventLog.filter(e =>
    e.scope.runId === scope.runId &&
    e.scope.taskId === scope.taskId &&
    e.scope.skillId === scope.skillId,
  )
}

/**
 * Get all coverage events (for debugging/inspection).
 */
export function getAllCoverageEvents(): CoverageEvent[] {
  return [...eventLog]
}

/**
 * Clear all coverage data (for tests).
 */
export function clearCoverage(): void {
  coverageMap.clear()
  eventLog.length = 0
}

// ─── Backward-compatible overloads ──────────────────────────────────────────

/**
 * Initialize coverage with just a skillId (backward compat).
 * Uses 'default' for runId and taskId.
 */
export function initCoverageLegacy(skillId: string, contract: SkillContract): SkillCoverage {
  return initCoverage({ runId: 'default', taskId: 'default', skillId }, contract)
}

export function markStageExecutedLegacy(skillId: string, stageId: string, exchangeId?: string): SkillCoverage | undefined {
  return markStageExecuted({ runId: 'default', taskId: 'default', skillId }, stageId, exchangeId)
}

export function markStageCoveredLegacy(skillId: string, stageId: string, findingId: string): SkillCoverage | undefined {
  return markStageCovered({ runId: 'default', taskId: 'default', skillId }, stageId, findingId)
}

export function markStageSkippedLegacy(skillId: string, stageId: string, reason?: string): SkillCoverage | undefined {
  return markStageSkipped({ runId: 'default', taskId: 'default', skillId }, stageId, reason)
}

export function getCoverageStatusLegacy(skillId: string): SkillCoverage | undefined {
  return getCoverageStatus({ runId: 'default', taskId: 'default', skillId })
}

export function getUncoveredStagesLegacy(skillId: string): StageCoverage[] {
  return getUncoveredStages({ runId: 'default', taskId: 'default', skillId })
}

export function coverageSummaryLegacy(skillId: string): string {
  return coverageSummary({ runId: 'default', taskId: 'default', skillId })
}

// ─── Internal ───────────────────────────────────────────────────────────────

function recalculate(coverage: SkillCoverage): void {
  coverage.coveredStages = coverage.stages.filter(
    s => s.status === 'covered' || s.status === 'skipped',
  ).length
  coverage.complete = coverage.coveredStages >= coverage.totalStages
}
