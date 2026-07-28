import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveEnginePreset, runSession } from '../../src/core/runner'
import type { UltimatrixConfig } from '../../src/config'

function baseConfig(overrides: Partial<UltimatrixConfig> = {}): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    target: 'https://example.com',
    creds: { groq: { apiKey: 'test' } },
    ...overrides,
  }
}

describe('resolveEnginePreset', () => {
  it('returns council preset when engine=council', () => {
    const preset = resolveEnginePreset(baseConfig({ engine: 'council' } as any))
    expect(preset.strategy).toBe('council')
    expect(preset.modelSelection).toBe(false)
  })

  it('returns council preset with hitl approval', () => {
    const preset = resolveEnginePreset(baseConfig({
      engine: 'council',
      council: { approvalMode: 'hitl' },
    } as any))
    expect(preset.strategy).toBe('council')
    expect(preset.approvalMode).toBe('hitl')
  })

  it('returns single preset for multi-model engine', () => {
    const preset = resolveEnginePreset(baseConfig({ engine: 'multi-model' } as any))
    expect(preset.strategy).toBe('single')
    expect(preset.modelSelection).toBe(true)
    expect(preset.approvalMode).toBe('autonomous')
  })

  it('returns single preset when engine is undefined (default)', () => {
    const preset = resolveEnginePreset(baseConfig())
    expect(preset.strategy).toBe('single')
    expect(preset.modelSelection).toBe(true)
  })

  it('returns single preset for solver engine alias', () => {
    const preset = resolveEnginePreset(baseConfig({ engine: 'solver' } as any))
    expect(preset.strategy).toBe('single')
  })
})

describe('runSession', () => {
  it('fails gracefully when strategy execution errors', async () => {
    const config = baseConfig()
    const result = await runSession({
      config,
      goal: 'test goal',
      toolPack: {},
    })
    expect(result.completed).toBe(false)
  })
})
