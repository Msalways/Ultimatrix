import { describe, it, expect } from 'vitest'
import { BenchmarkHarness } from '../../src/evals/benchmark-harness'
import type { TaskTelemetry } from '../../src/telemetry/types'

function fakeTelemetry(overrides: Partial<TaskTelemetry> = {}): TaskTelemetry {
  return {
    identity: { runId: 'run-1', taskId: 'task-1', skillId: 'authorization', model: 'groq/llama3-8b-8192', provider: 'groq' },
    context: { visibleTools: ['httpRequest'], visiblePrimitives: ['idorSwapper'], toolSchemaTokens: 600, skillTokens: 200, retrievedContextTokens: 300 },
    reasoning: { modelCalls: 5, toolCalls: 10, invalidToolCalls: 2, irrelevantToolCalls: 1, retries: 0 },
    evidence: { evidenceCreated: 3, artifactsCreated: 1, candidateFindings: 2, acceptedFindings: 1, rejectedFindings: 1 },
    durationMs: 30000,
    startedAt: Date.now(),
    endedAt: Date.now() + 30000,
    ...overrides,
  }
}

describe('BenchmarkHarness', () => {
  it('returns empty report when no tasks recorded', () => {
    const harness = new BenchmarkHarness()
    const report = harness.generateReport()
    expect(report.taskCount).toBe(0)
    expect(report.hasImprovement).toBe(false)
  })

  it('records baseline and improved telemetry', () => {
    const harness = new BenchmarkHarness()
    harness.recordBaseline('t1', fakeTelemetry())
    harness.recordImproved('t1', fakeTelemetry())
    const report = harness.generateReport()
    expect(report.taskCount).toBe(1)
  })

  it('detects context reduction improvement', () => {
    const harness = new BenchmarkHarness()
    harness.recordBaseline('t1', fakeTelemetry({
      context: { visibleTools: ['httpRequest', 'runPrimitive', 'queryGraph', 'writeFinding'], visiblePrimitives: ['idorSwapper', 'authzMatrix'], toolSchemaTokens: 2400, skillTokens: 800, retrievedContextTokens: 1200 },
    }))
    harness.recordImproved('t1', fakeTelemetry({
      context: { visibleTools: ['httpRequest'], visiblePrimitives: ['idorSwapper'], toolSchemaTokens: 600, skillTokens: 200, retrievedContextTokens: 300 },
    }))
    const report = harness.generateReport()
    expect(report.taskCount).toBe(1)
    expect(report.aggregateDiff.contextReduction).toBeGreaterThan(0)
    expect(report.hasImprovement).toBe(true)
  })

  it('detects tool reduction improvement', () => {
    const harness = new BenchmarkHarness()
    harness.recordBaseline('t1', fakeTelemetry({
      context: { visibleTools: ['a', 'b', 'c', 'd', 'e'], visiblePrimitives: [], toolSchemaTokens: 300, skillTokens: 100, retrievedContextTokens: 50 },
    }))
    harness.recordImproved('t1', fakeTelemetry({
      context: { visibleTools: ['a', 'b'], visiblePrimitives: [], toolSchemaTokens: 120, skillTokens: 100, retrievedContextTokens: 50 },
    }))
    const report = harness.generateReport()
    expect(report.aggregateDiff.toolReduction).toBeGreaterThan(0)
  })

  it('handles multiple tasks', () => {
    const harness = new BenchmarkHarness()
    harness.recordBaseline('t1', fakeTelemetry())
    harness.recordImproved('t1', fakeTelemetry())
    harness.recordBaseline('t2', fakeTelemetry({ identity: { runId: 'run-1', taskId: 't2', skillId: 'injection', model: 'groq/llama3-8b-8192', provider: 'groq' } }))
    harness.recordImproved('t2', fakeTelemetry({ identity: { runId: 'run-1', taskId: 't2', skillId: 'injection', model: 'groq/llama3-8b-8192', provider: 'groq' } }))
    const report = harness.generateReport()
    expect(report.taskCount).toBe(2)
    expect(report.taskDiffs).toHaveLength(2)
  })

  it('reports no improvement when metrics are identical', () => {
    const harness = new BenchmarkHarness()
    const t = fakeTelemetry()
    harness.recordBaseline('t1', t)
    harness.recordImproved('t1', t)
    const report = harness.generateReport()
    expect(report.hasImprovement).toBe(false)
  })

  it('generates human-readable summary', () => {
    const harness = new BenchmarkHarness()
    harness.recordBaseline('t1', fakeTelemetry())
    harness.recordImproved('t1', fakeTelemetry())
    const report = harness.generateReport()
    expect(report.summary).toContain('Benchmark: 1 tasks')
    expect(typeof report.summary).toBe('string')
  })
})
