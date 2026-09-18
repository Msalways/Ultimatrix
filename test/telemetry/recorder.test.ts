import { describe, it, expect, beforeEach } from 'vitest'
import {
  TelemetryBuilder,
  TelemetryRecorder,
  getGlobalTelemetryRecorder,
  resetGlobalTelemetryRecorder,
} from '../../src/telemetry/recorder'

describe('TelemetryBuilder', () => {
  it('builds a complete telemetry record', () => {
    const builder = new TelemetryBuilder({
      runId: 'run-1',
      taskId: 'task-1',
      model: 'gpt-4',
      provider: 'openai',
    })

    builder
      .setVisibleContext(['httpRequest', 'writeFinding'], ['idorSwapper'])
      .setTokenEstimates({ toolSchemaTokens: 120, skillTokens: 200, retrievedContextTokens: 500 })
      .recordToolCall({ toolId: 'httpRequest', timestamp: Date.now(), durationMs: 150, success: true })
      .recordModelCall({ timestamp: Date.now(), inputTokens: 1000, outputTokens: 500, durationMs: 2000, model: 'gpt-4' })
      .recordEvidence(2)
      .recordArtifact(1)
      .recordCandidateFinding()

    const telemetry = builder.build()

    expect(telemetry.identity.runId).toBe('run-1')
    expect(telemetry.identity.taskId).toBe('task-1')
    expect(telemetry.context.visibleTools).toEqual(['httpRequest', 'writeFinding'])
    expect(telemetry.context.visiblePrimitives).toEqual(['idorSwapper'])
    expect(telemetry.context.toolSchemaTokens).toBe(120)
    expect(telemetry.context.skillTokens).toBe(200)
    expect(telemetry.context.retrievedContextTokens).toBe(500)
    expect(telemetry.reasoning.modelCalls).toBe(1)
    expect(telemetry.reasoning.toolCalls).toBe(1)
    expect(telemetry.evidence.evidenceCreated).toBe(2)
    expect(telemetry.evidence.artifactsCreated).toBe(1)
    expect(telemetry.evidence.candidateFindings).toBe(1)
    expect(telemetry.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('tracks first action time', () => {
    const builder = new TelemetryBuilder({
      runId: 'run-1',
      taskId: 'task-1',
      model: 'gpt-4',
      provider: 'openai',
    })

    const now = Date.now()
    builder.recordToolCall({ toolId: 'httpRequest', timestamp: now, durationMs: 100, success: true })

    const telemetry = builder.build()
    expect(telemetry.reasoning.firstActionMs).toBeDefined()
    expect(telemetry.reasoning.firstActionMs).toBeGreaterThanOrEqual(0)
  })

  it('tracks invalid tool calls', () => {
    const builder = new TelemetryBuilder({
      runId: 'run-1',
      taskId: 'task-1',
      model: 'gpt-4',
      provider: 'openai',
    })

    builder
      .recordToolCall({ toolId: 'httpRequest', timestamp: Date.now(), durationMs: 100, success: true })
      .recordToolCall({ toolId: 'badTool', timestamp: Date.now(), durationMs: 50, success: false, error: 'not found' })

    const telemetry = builder.build()
    expect(telemetry.reasoning.toolCalls).toBe(2)
    expect(telemetry.reasoning.invalidToolCalls).toBe(1)
  })

  it('tracks findings accepted and rejected', () => {
    const builder = new TelemetryBuilder({
      runId: 'run-1',
      taskId: 'task-1',
      model: 'gpt-4',
      provider: 'openai',
    })

    builder
      .recordCandidateFinding()
      .recordCandidateFinding()
      .recordCandidateFinding()
      .recordFindingAccepted()
      .recordFindingRejected()

    const telemetry = builder.build()
    expect(telemetry.evidence.candidateFindings).toBe(3)
    expect(telemetry.evidence.acceptedFindings).toBe(1)
    expect(telemetry.evidence.rejectedFindings).toBe(1)
  })

  it('tracks retries', () => {
    const builder = new TelemetryBuilder({
      runId: 'run-1',
      taskId: 'task-1',
      model: 'gpt-4',
      provider: 'openai',
    })

    builder.recordRetry().recordRetry().recordRetry()

    const telemetry = builder.build()
    expect(telemetry.reasoning.retries).toBe(3)
  })
})

describe('TelemetryRecorder', () => {
  let recorder: TelemetryRecorder

  beforeEach(() => {
    recorder = new TelemetryRecorder()
  })

  it('starts and ends a task', () => {
    const builder = recorder.start('run-1', 'task-1', 'gpt-4', 'openai', 'authorization')
    expect(builder).toBeInstanceOf(TelemetryBuilder)

    const telemetry = recorder.end('task-1')
    expect(telemetry).toBeDefined()
    expect(telemetry!.identity.runId).toBe('run-1')
    expect(telemetry!.identity.taskId).toBe('task-1')
    expect(telemetry!.identity.skillId).toBe('authorization')
  })

  it('returns undefined for unknown task', () => {
    const telemetry = recorder.end('unknown-task')
    expect(telemetry).toBeUndefined()
  })

  it('gets active builder', () => {
    recorder.start('run-1', 'task-1', 'gpt-4', 'openai')
    const builder = recorder.getBuilder('task-1')
    expect(builder).toBeDefined()

    const noBuilder = recorder.getBuilder('unknown')
    expect(noBuilder).toBeUndefined()
  })

  it('collects completed telemetry', () => {
    recorder.start('run-1', 'task-1', 'gpt-4', 'openai')
    recorder.start('run-1', 'task-2', 'gpt-4', 'openai')

    recorder.end('task-1')
    recorder.end('task-2')

    const completed = recorder.getCompleted()
    expect(completed).toHaveLength(2)
  })

  it('filters by run ID', () => {
    recorder.start('run-1', 'task-1', 'gpt-4', 'openai')
    recorder.start('run-2', 'task-2', 'gpt-4', 'openai')

    recorder.end('task-1')
    recorder.end('task-2')

    const run1 = recorder.getRunTelemetry('run-1')
    expect(run1).toHaveLength(1)
    expect(run1[0].identity.taskId).toBe('task-1')
  })

  it('clears all telemetry', () => {
    recorder.start('run-1', 'task-1', 'gpt-4', 'openai')
    recorder.end('task-1')

    recorder.clear()
    expect(recorder.getCompleted()).toHaveLength(0)
  })
})

describe('Global Telemetry Recorder', () => {
  beforeEach(() => {
    resetGlobalTelemetryRecorder()
  })

  it('creates singleton instance', () => {
    const r1 = getGlobalTelemetryRecorder()
    const r2 = getGlobalTelemetryRecorder()
    expect(r1).toBe(r2)
  })

  it('resets instance', () => {
    const r1 = getGlobalTelemetryRecorder()
    r1.start('run-1', 'task-1', 'gpt-4', 'openai')
    resetGlobalTelemetryRecorder()
    const r2 = getGlobalTelemetryRecorder()
    expect(r1).not.toBe(r2)
  })
})
