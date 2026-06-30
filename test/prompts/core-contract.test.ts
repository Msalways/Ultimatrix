import { describe, it, expect } from 'vitest'
import { CORE_CONTRACT } from '../../src/prompts/core-contract'

describe('CORE_CONTRACT', () => {
  it('exports a non-empty string', () => {
    expect(typeof CORE_CONTRACT).toBe('string')
    expect(CORE_CONTRACT.length).toBeGreaterThan(100)
  })

  it('contains authorization framing', () => {
    expect(CORE_CONTRACT).toContain('AUTHORIZED')
    expect(CORE_CONTRACT).toContain('sandbox')
  })

  it('contains anti-hallucination rules', () => {
    expect(CORE_CONTRACT).toContain('NEVER fabricate tool call results')
    expect(CORE_CONTRACT).toContain('NEVER fabricate flags')
    expect(CORE_CONTRACT).toContain('NEVER skip verification')
  })

  it('contains workflow guidance', () => {
    expect(CORE_CONTRACT).toContain('Passive before active')
    expect(CORE_CONTRACT).toContain('one variable at a time')
  })

  it('contains assumption verification', () => {
    expect(CORE_CONTRACT).toContain('Assumption Verification')
    expect(CORE_CONTRACT).toContain('Unverified assumptions')
  })

  it('contains path diversity', () => {
    expect(CORE_CONTRACT).toContain('Path Diversity')
    expect(CORE_CONTRACT).toContain('3 consecutive failures')
  })

  it('contains output format rules', () => {
    expect(CORE_CONTRACT).toContain('[+]')
    expect(CORE_CONTRACT).toContain('[!]')
  })

  it('contains no Chinese characters', () => {
    const chinese = CORE_CONTRACT.match(/[\u4e00-\u9fff]/g)
    expect(chinese).toBeNull()
  })
})
