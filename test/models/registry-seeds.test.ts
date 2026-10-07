import { describe, expect, it } from 'vitest'
import { ContextWindowRegistry } from '../../src/models/context-window-registry'
import { LiveModelRegistry } from '../../src/models/registry'

describe('bundled model registry seeds', () => {
  it('resolves NVIDIA Nemotron 3 Super limits for safe dispatch', () => {
    const profile = new LiveModelRegistry().getProfile('nvidia', 'nemotron-3-super-120b-a12b')
    expect(profile).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 32_768,
      toolCalling: true,
      source: 'seed',
    })

    const limits = new ContextWindowRegistry({ provider: 'nvidia' } as any)
      .resolve('nvidia/nemotron-3-super-120b-a12b')
    expect(limits).toEqual({
      contextWindow: 1_000_000,
      maxOutputTokens: 32_768,
      reservedMargin: 1024,
    })
  })
})
