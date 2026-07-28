import { describe, it, expect } from 'vitest'
import type { EnginePreset, RunResult, CoreServices, StrategyContext } from '../../src/core/types'

describe('Core types', () => {
  it('EnginePreset has correct shape', () => {
    const preset: EnginePreset = {
      strategy: 'single',
      approvalMode: 'autonomous',
      modelSelection: true,
    }
    expect(preset.strategy).toBe('single')
    expect(preset.approvalMode).toBe('autonomous')
    expect(preset.modelSelection).toBe(true)
  })

  it('RunResult has correct shape', () => {
    const result: RunResult = {
      completed: true,
      findings: [],
      rounds: 1,
      duration: 1000,
    }
    expect(result.completed).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.rounds).toBe(1)
  })

  it('StrategyContext accepts all fields', () => {
    const ctx: StrategyContext = {
      goal: 'test',
      config: {
        provider: 'groq',
        model: 'test',
        creds: { groq: { apiKey: 'x' } },
      },
      services: {
        evidence: {} as any,
        blackboard: {} as any,
      },
      toolPack: {},
    }
    expect(ctx.goal).toBe('test')
    expect(ctx.toolPack).toEqual({})
  })
})
