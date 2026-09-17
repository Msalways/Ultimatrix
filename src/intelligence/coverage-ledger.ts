/**
 * Coverage Ledger (Strix Adaptation Phase G) — persistent coverage tracking.
 *
 * Tracks which skill contract stages have been executed and which findings
 * cover each stage. The LLM can query coverage to know what's been tested
 * and what's still missing. Persists to the graph store.
 */

import { randomUUID } from 'node:crypto'
import type { SkillContract, ProcedureStage } from '../solver/skills/loader'
import { getGlobalGraphStore } from '../graph/store'

export type StageStatus = 'pending' | 'executed' | 'covered' | 'skipped'

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
  skillId: string
  stages: StageCoverage[]
  complete: boolean
  totalStages: number
  coveredStages: number
  lastUpdated: number
}

/** In-memory coverage state keyed by skillId */
const coverageMap = new Map<string, SkillCoverage>()

/**
 * Initialize coverage tracking for a skill from its contract.
 * Idempotent: calling again with the same skillId doesn't overwrite existing state.
 */
export function initCoverage(skillId: string, contract: SkillContract): SkillCoverage {
  const existing = coverageMap.get(skillId)
  if (existing) return existing

  const stages: StageCoverage[] = contract.procedure.map(s => ({
    stageId: s.id,
    goal: s.goal,
    status: 'pending' as StageStatus,
    exchangeIds: [],
    findingIds: [],
  }))

  const coverage: SkillCoverage = {
    skillId,
    stages,
    complete: false,
    totalStages: stages.length,
    coveredStages: 0,
    lastUpdated: Date.now(),
  }

  coverageMap.set(skillId, coverage)
  return coverage
}

/**
 * Mark a stage as executed (test was run against it).
 */
export function markStageExecuted(
  skillId: string,
  stageId: string,
  exchangeId?: string,
): SkillCoverage | undefined {
  const coverage = coverageMap.get(skillId)
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
  return coverage
}

/**
 * Mark a stage as covered (finding confirms it was tested successfully).
 */
export function markStageCovered(
  skillId: string,
  stageId: string,
  findingId: string,
): SkillCoverage | undefined {
  const coverage = coverageMap.get(skillId)
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
  return coverage
}

/**
 * Skip a stage (not applicable for this target).
 */
export function markStageSkipped(
  skillId: string,
  stageId: string,
  reason?: string,
): SkillCoverage | undefined {
  const coverage = coverageMap.get(skillId)
  if (!coverage) return undefined

  const stage = coverage.stages.find(s => s.stageId === stageId)
  if (!stage) return undefined

  stage.status = 'skipped'
  coverage.lastUpdated = Date.now()
  recalculate(coverage)
  return coverage
}

/**
 * Get the current coverage status for a skill.
 */
export function getCoverageStatus(skillId: string): SkillCoverage | undefined {
  return coverageMap.get(skillId)
}

/**
 * Get uncovered stages for a skill — what still needs testing.
 */
export function getUncoveredStages(skillId: string): StageCoverage[] {
  const coverage = coverageMap.get(skillId)
  if (!coverage) return []
  return coverage.stages.filter(s => s.status === 'pending' || s.status === 'executed')
}

/**
 * Get a summary string suitable for LLM context.
 */
export function coverageSummary(skillId: string): string {
  const coverage = coverageMap.get(skillId)
  if (!coverage) return `No coverage data for ${skillId}`

  const lines = [`## Coverage: ${skillId}`]
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
 * Clear all coverage data (for tests).
 */
export function clearCoverage(): void {
  coverageMap.clear()
}

// ─── Internal ───────────────────────────────────────────────────────────────

function recalculate(coverage: SkillCoverage): void {
  coverage.coveredStages = coverage.stages.filter(
    s => s.status === 'covered' || s.status === 'skipped',
  ).length
  coverage.complete = coverage.coveredStages >= coverage.totalStages
}
