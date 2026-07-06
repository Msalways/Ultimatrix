import { describe, it, expect, beforeEach } from 'vitest'
import { TokenProfiler, type ToolExecutionResult } from '../../src/tools/token-profiler'

describe('TokenProfiler', () => {
  let profiler: TokenProfiler

  beforeEach(() => {
    profiler = new TokenProfiler()
  })

  it('returns heuristic default for unknown tool', () => {
    const profile = profiler.getProfile('unknownTool')
    expect(profile.toolId).toBe('unknownTool')
    expect(profile.estimated).toBe(true)
    expect(profile.sampleCount).toBe(0)
    expect(profile.avgModelCalls).toBeGreaterThan(0)
  })

  it('returns known default for httpRequest', () => {
    const profile = profiler.getProfile('httpRequest')
    expect(profile.avgModelCalls).toBe(1.5)
    expect(profile.avgInputTokens).toBe(800)
    expect(profile.estimated).toBe(true)
  })

  it('records execution and updates profile via EMA', () => {
    profiler.recordExecution({
      toolId: 'checkWaf',
      modelCalls: 3,
      inputTokens: 1500,
      outputTokens: 700,
      externalApiCalls: 0,
      durationMs: 100,
      success: true,
    })

    const profile = profiler.getProfile('checkWaf')
    expect(profile.sampleCount).toBe(1)
    expect(profile.estimated).toBe(false)
    expect(profile.avgModelCalls).toBe(3)
    expect(profile.avgInputTokens).toBe(1500)
  })

  it('EMA converges on repeated executions', () => {
    for (let i = 0; i < 10; i++) {
      profiler.recordExecution({
        toolId: 'httpRequest',
        modelCalls: 2,
        inputTokens: 1000,
        outputTokens: 500,
        externalApiCalls: 0,
        durationMs: 100,
        success: true,
      })
    }

    const profile = profiler.getProfile('httpRequest')
    expect(profile.sampleCount).toBe(10)
    // After many executions at 2 calls, EMA should be close to 2
    expect(profile.avgModelCalls).toBeCloseTo(2, 0)
  })

  it('getDefaultProfile returns estimated profile', () => {
    const profile = profiler.getDefaultProfile('unknownTool')
    expect(profile.estimated).toBe(true)
    expect(profile.sampleCount).toBe(0)
  })

  it('persist and load round-trip', () => {
    profiler.recordExecution({
      toolId: 'myTool',
      modelCalls: 2,
      inputTokens: 1000,
      outputTokens: 500,
      externalApiCalls: 0,
      durationMs: 50,
      success: true,
    })

    const data = profiler.persist()
    const newProfiler = new TokenProfiler()
    newProfiler.load(data)

    const profile = newProfiler.getProfile('myTool')
    expect(profile.sampleCount).toBe(1)
    expect(profile.avgModelCalls).toBe(2)
  })

  it('reset clears all profiles', () => {
    profiler.recordExecution({
      toolId: 'myTool',
      modelCalls: 2,
      inputTokens: 1000,
      outputTokens: 500,
      externalApiCalls: 0,
      durationMs: 50,
      success: true,
    })

    profiler.reset()
    const profile = profiler.getProfile('myTool')
    expect(profile.estimated).toBe(true)
    expect(profile.sampleCount).toBe(0)
  })
})
