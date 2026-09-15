/**
 * Curriculum Practice — post-engagement analysis + lesson extraction.
 *
 * At engagement end:
 *   - Analyze outcome feedback + mistakes + preferences
 *   - Extract lessons: "SQLi worked 80% on REST APIs"
 *   - Rank techniques by success/failure ratio
 *   - Update technique registry weights
 *
 * Adapted from PWN curriculum.md.
 */

export interface Lesson {
  source: 'outcome_feedback' | 'mistakes' | 'preferences'
  technique: string
  outcome: 'success' | 'failure' | 'mixed'
  context: string
  detail: string
}

export interface TechniqueRanking {
  technique: string
  successRate: number
  totalAttempts: number
  recommendation: 'boost' | 'maintain' | 'deprioritize'
}

export interface CurriculumReport {
  targetOrigin: string
  analyzedAt: string
  lessons: Lesson[]
  techniqueRankings: TechniqueRanking[]
  topFailures: string[]
}

/**
 * Analyze engagement data and produce a curriculum report.
 * This is a pure-function analysis — no side effects.
 */
export function analyzeEngagement(params: {
  targetOrigin: string
  outcomes: Array<{ technique: string; accepted: boolean }>
  mistakes: Array<{ toolName: string; errorPattern: string; occurrences: number }>
  preferences: Array<{ technique: string; outcome: 'success' | 'failure' }>
}): CurriculumReport {
  const lessons: Lesson[] = []
  const techniqueStats = new Map<string, { success: number; total: number }>()

  // Process outcomes
  for (const o of params.outcomes) {
    const stats = techniqueStats.get(o.technique) ?? { success: 0, total: 0 }
    stats.total++
    if (o.accepted) stats.success++
    techniqueStats.set(o.technique, stats)

    lessons.push({
      source: 'outcome_feedback',
      technique: o.technique,
      outcome: o.accepted ? 'success' : 'failure',
      context: params.targetOrigin,
      detail: o.accepted ? `Accepted by reviewer` : `Rejected`,
    })
  }

  // Process mistakes
  for (const m of params.mistakes) {
    if (m.occurrences >= 2) {
      lessons.push({
        source: 'mistakes',
        technique: m.toolName,
        outcome: 'failure',
        context: params.targetOrigin,
        detail: `${m.errorPattern} (×${m.occurrences})`,
      })
    }
  }

  // Process preferences
  for (const p of params.preferences) {
    lessons.push({
      source: 'preferences',
      technique: p.technique,
      outcome: p.outcome,
      context: params.targetOrigin,
      detail: `Preference pair: ${p.outcome}`,
    })
  }

  // Rank techniques
  const rankings: TechniqueRanking[] = []
  for (const [technique, stats] of techniqueStats) {
    const successRate = stats.total > 0 ? stats.success / stats.total : 0
    rankings.push({
      technique,
      successRate,
      totalAttempts: stats.total,
      recommendation: successRate >= 0.7 ? 'boost' : successRate >= 0.3 ? 'maintain' : 'deprioritize',
    })
  }
  rankings.sort((a, b) => b.successRate - a.successRate)

  // Top failures
  const topFailures = rankings
    .filter(r => r.recommendation === 'deprioritize')
    .map(r => r.technique)

  return {
    targetOrigin: params.targetOrigin,
    analyzedAt: new Date().toISOString(),
    lessons,
    techniqueRankings: rankings,
    topFailures,
  }
}
