import { describe, it, expect } from 'vitest'
import type { TaskTelemetry, RunTelemetry } from '../../src/telemetry/types'
import { aggregateTelemetry, compareTelemetry, formatDiffReport } from '../../src/telemetry/aggregator'

function makeTask(overrides: Partial<TaskTelemetry['identity']> & {
  toolCount?: number
  contextTokens?: number
  skillTokens?: number
  retrievedContextTokens?: number
  modelCalls?: number
  toolCalls?: number
  invalidToolCalls?: number
  retries?: number
  evidenceCreated?: number
  candidateFindings?: number
  acceptedFindings?: number
  rejectedFindings?: number
  durationMs?: number
} = {}): TaskTelemetry {
  const now = Date.now()
  const skillTok = overrides.skillTokens ?? 200
  const retrievedTok = overrides.retrievedContextTokens ?? 100
  return {
    identity: {
      runId: overrides.runId ?? 'run-1',
      taskId: overrides.taskId ?? 'task-1',
      skillId: overrides.skillId,
      model: overrides.model ?? 'gpt-4',
      provider: overrides.provider ?? 'openai',
    },
    context: {
      visibleTools: Array(overrides.toolCount ?? 5).fill('tool'),
      visiblePrimitives: [],
      toolSchemaTokens: overrides.contextTokens ?? 300,
      skillTokens: skillTok,
      retrievedContextTokens: retrievedTok,
    },
    reasoning: {
      modelCalls: overrides.modelCalls ?? 3,
      toolCalls: overrides.toolCalls ?? 5,
      invalidToolCalls: overrides.invalidToolCalls ?? 0,
      irrelevantToolCalls: 0,
      retries: overrides.retries ?? 0,
    },
    evidence: {
      evidenceCreated: overrides.evidenceCreated ?? 2,
      artifactsCreated: 1,
      candidateFindings: overrides.candidateFindings ?? 1,
      acceptedFindings: overrides.acceptedFindings ?? 0,
      rejectedFindings: overrides.rejectedFindings ?? 0,
    },
    durationMs: overrides.durationMs ?? 5000,
    startedAt: now,
    endedAt: now + (overrides.durationMs ?? 5000),
  }
}

describe('aggregateTelemetry', () => {
  it('returns zeroed summary for empty input', () => {
    const result = aggregateTelemetry([])
    expect(result.taskCount).toBe(0)
    expect(result.totalDurationMs).toBe(0)
    expect(result.acceptanceRate).toBe(0)
  })

  it('aggregates single task', () => {
    const task = makeTask({ taskId: 't-1', toolCount: 10, contextTokens: 200, skillTokens: 100, retrievedContextTokens: 50 })
    const result = aggregateTelemetry([task])

    expect(result.taskCount).toBe(1)
    expect(result.avgToolsPerTask).toBe(10)
    expect(result.avgContextTokens).toBe(350) // 200 + 100 + 50
  })

  it('averages across multiple tasks', () => {
    const tasks = [
      makeTask({ taskId: 't-1', toolCount: 10, contextTokens: 100, skillTokens: 50, retrievedContextTokens: 50, modelCalls: 5 }),
      makeTask({ taskId: 't-2', toolCount: 20, contextTokens: 200, skillTokens: 100, retrievedContextTokens: 100, modelCalls: 10 }),
    ]
    const result = aggregateTelemetry(tasks)

    expect(result.taskCount).toBe(2)
    expect(result.avgToolsPerTask).toBe(15)
    expect(result.avgContextTokens).toBe(300) // avg of 200 and 400
    expect(result.totalModelCalls).toBe(15)
  })

  it('calculates acceptance rate', () => {
    const tasks = [
      makeTask({ candidateFindings: 3, acceptedFindings: 2 }),
      makeTask({ candidateFindings: 1, acceptedFindings: 0 }),
    ]
    const result = aggregateTelemetry(tasks)

    expect(result.totalCandidateFindings).toBe(4)
    expect(result.totalAcceptedFindings).toBe(2)
    expect(result.acceptanceRate).toBe(0.5)
  })

  it('handles zero candidates', () => {
    const tasks = [makeTask({ candidateFindings: 0 })]
    const result = aggregateTelemetry(tasks)
    expect(result.acceptanceRate).toBe(0)
  })
})

describe('compareTelemetry', () => {
  it('calculates percentage reductions', () => {
    const baseline = aggregateTelemetry([
      makeTask({ toolCount: 20, contextTokens: 400, skillTokens: 200, retrievedContextTokens: 100, invalidToolCalls: 5, durationMs: 10000 }),
    ])
    const improved = aggregateTelemetry([
      makeTask({ toolCount: 10, contextTokens: 200, skillTokens: 100, retrievedContextTokens: 50, invalidToolCalls: 1, durationMs: 8000 }),
    ])

    const diff = compareTelemetry(baseline, improved)

    expect(diff.contextReduction).toBe(50) // 700 -> 350 = 50% reduction
    expect(diff.toolReduction).toBe(50)     // 20 -> 10 = 50% reduction
    expect(diff.invalidCallReduction).toBe(80) // 5 -> 1 = 80% reduction
    expect(diff.durationChange).toBe(20) // 10000 -> 8000 = 20% reduction
  })

  it('calculates acceptance rate change', () => {
    const baseline = aggregateTelemetry([
      makeTask({ candidateFindings: 10, acceptedFindings: 2 }),
    ])
    const improved = aggregateTelemetry([
      makeTask({ candidateFindings: 10, acceptedFindings: 5 }),
    ])

    const diff = compareTelemetry(baseline, improved)
    expect(diff.acceptanceRateChange).toBeCloseTo(0.3)
  })

  it('handles zero baseline values', () => {
    const baseline = aggregateTelemetry([
      makeTask({ invalidToolCalls: 0 }),
    ])
    const improved = aggregateTelemetry([
      makeTask({ invalidToolCalls: 0 }),
    ])

    const diff = compareTelemetry(baseline, improved)
    expect(diff.invalidCallReduction).toBe(0)
  })
})

describe('formatDiffReport', () => {
  it('formats a readable report', () => {
    const report = formatDiffReport({
      contextReduction: 45.2,
      toolReduction: 60,
      invalidCallReduction: 80,
      acceptanceRateChange: 0.15,
      durationChange: -10,
    })

    expect(report).toContain('Context tokens')
    expect(report).toContain('+45.2%')
    expect(report).toContain('+60.0%')
    expect(report).toContain('+15.0pp')
    expect(report).toContain('-10.0%')
  })
})
