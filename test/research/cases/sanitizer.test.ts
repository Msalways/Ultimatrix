import { describe, it, expect } from 'vitest'
import { sanitizeForMemory, containsSensitiveValues } from '../../../src/research/cases/sanitizer'
import type { ResearchCase } from '../../../src/research/cases/types'

function makeCase(overrides: Partial<ResearchCase> = {}): ResearchCase {
  return {
    id: 'case-1',
    domain: 'authorization',
    initialHypothesis: 'IDOR on /api/users',
    contextFeatures: ['skill:authorization'],
    decisiveEvidence: ['response difference confirmed'],
    counterEvidence: [],
    outcome: 'validated',
    sourceRefs: ['ev-1'],
    ...overrides,
  }
}

describe('sanitizeForMemory', () => {
  it('removes URLs from hypothesis', () => {
    const caseData = makeCase({
      initialHypothesis: 'IDOR on https://example.com/api/users/42',
    })
    const sanitized = sanitizeForMemory(caseData)
    expect(sanitized.initialHypothesis).not.toContain('https://example.com')
    expect(sanitized.initialHypothesis).toContain('[REDACTED]')
  })

  it('removes JWT tokens', () => {
    const caseData = makeCase({
      falsePositiveReason: 'Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U was valid',
    })
    const sanitized = sanitizeForMemory(caseData)
    expect(sanitized.falsePositiveReason).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  it('removes IP addresses', () => {
    const caseData = makeCase({
      killSignal: 'Target at 192.168.1.100 is behind VPN',
    })
    const sanitized = sanitizeForMemory(caseData)
    expect(sanitized.killSignal).not.toContain('192.168.1.100')
  })

  it('removes source refs', () => {
    const caseData = makeCase({ sourceRefs: ['ev-1', 'ev-2'] })
    const sanitized = sanitizeForMemory(caseData)
    expect(sanitized.sourceRefs).toHaveLength(0)
  })

  it('preserves framework patterns', () => {
    const caseData = makeCase({
      reusableLesson: 'Verify ownership separation before classifying equal responses as IDOR',
    })
    const sanitized = sanitizeForMemory(caseData)
    expect(sanitized.reusableLesson).toContain('IDOR')
    expect(sanitized.reusableLesson).toContain('ownership separation')
  })

  it('preserves non-sensitive text', () => {
    const caseData = makeCase({
      initialHypothesis: 'Authorization boundary test on API endpoint',
    })
    const sanitized = sanitizeForMemory(caseData)
    expect(sanitized.initialHypothesis).toBe('Authorization boundary test on API endpoint')
  })
})

describe('containsSensitiveValues', () => {
  it('detects URLs', () => {
    expect(containsSensitiveValues('Check https://example.com')).toBe(true)
  })

  it('detects JWT tokens', () => {
    expect(containsSensitiveValues('Token: eyJhbGciOiJIUzI1NiJ9.xxx')).toBe(true)
  })

  it('detects IP addresses', () => {
    expect(containsSensitiveValues('Server at 10.0.0.1')).toBe(true)
  })

  it('detects secrets', () => {
    expect(containsSensitiveValues('password: hunter2')).toBe(true)
  })

  it('returns false for clean text', () => {
    expect(containsSensitiveValues('Authorization boundary test')).toBe(false)
  })
})
