import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FindingNode } from '../graph/schema'

const mockChainFindings = vi.fn()

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({
    chainFindings: mockChainFindings,
  }),
}))

function makeFinding(overrides: Partial<FindingNode['properties']> & { id: string; technique: string }): FindingNode {
  return {
    id: overrides.id,
    type: 'Finding' as any,
    label: `Finding: ${overrides.technique}`,
    properties: {
      severity: 'medium',
      endpoint: '/test',
      evidence: [],
      confidence: 0.8,
      ...overrides,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as FindingNode
}

describe('FindingChaining', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('detectChains', () => {
    it('returns chains when related findings exist', async () => {
      const { detectChains } = await import('../../src/intelligence/chaining')
      const findings = [
        makeFinding({ id: 'f1', technique: 'xss', endpoint: '/search' }),
        makeFinding({ id: 'f2', technique: 'session-hijack', endpoint: '/search' }),
      ]
      const chains = detectChains(findings)
      expect(chains).toHaveLength(1)
      expect(chains[0].source.id).toBe('f1')
      expect(chains[0].target.id).toBe('f2')
      expect(chains[0].rule.name).toContain('xss-to-session-hijack')
      expect(mockChainFindings).toHaveBeenCalledWith('f1', 'f2')
    })

    it('returns empty array when no matching rules', async () => {
      const { detectChains } = await import('../../src/intelligence/chaining')
      const findings = [
        makeFinding({ id: 'f1', technique: 'xss', endpoint: '/search' }),
        makeFinding({ id: 'f2', technique: 'xss', endpoint: '/other' }),
      ]
      const chains = detectChains(findings)
      expect(chains).toHaveLength(0)
    })

    it('does not chain a finding with itself', async () => {
      const { detectChains } = await import('../../src/intelligence/chaining')
      const findings = [
        makeFinding({ id: 'f1', technique: 'ssrf', endpoint: '/proxy' }),
      ]
      const chains = detectChains(findings)
      expect(chains).toHaveLength(0)
    })

    it('returns empty for empty findings', async () => {
      const { detectChains } = await import('../../src/intelligence/chaining')
      const chains = detectChains([])
      expect(chains).toEqual([])
    })

    it('finds multiple chain matches', async () => {
      const { detectChains } = await import('../../src/intelligence/chaining')
      const findings = [
        makeFinding({ id: 'f1', technique: 'sqli', endpoint: '/api' }),
        makeFinding({ id: 'f2', technique: 'data-exfiltration', endpoint: '/api' }),
        makeFinding({ id: 'f3', technique: 'sqli', endpoint: '/other' }),
        makeFinding({ id: 'f4', technique: 'data-exfiltration', endpoint: '/other' }),
      ]
      const chains = detectChains(findings)
      expect(chains.length).toBeGreaterThanOrEqual(1)
      expect(mockChainFindings).toHaveBeenCalled()
    })
  })

  describe('suggestFollowUp', () => {
    it('returns sqli suggestions', async () => {
      const { suggestFollowUp } = await import('../../src/intelligence/chaining')
      const finding = makeFinding({ id: 'f1', technique: 'sqli', endpoint: '/api' })
      const suggestions = suggestFollowUp(finding)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('returns xss suggestions', async () => {
      const { suggestFollowUp } = await import('../../src/intelligence/chaining')
      const finding = makeFinding({ id: 'f1', technique: 'xss', endpoint: '/search' })
      const suggestions = suggestFollowUp(finding)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('returns idor suggestions', async () => {
      const { suggestFollowUp } = await import('../../src/intelligence/chaining')
      const finding = makeFinding({ id: 'f1', technique: 'idor', endpoint: '/users/1' })
      const suggestions = suggestFollowUp(finding)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('returns ssrf suggestions', async () => {
      const { suggestFollowUp } = await import('../../src/intelligence/chaining')
      const finding = makeFinding({ id: 'f1', technique: 'ssrf', endpoint: '/proxy' })
      const suggestions = suggestFollowUp(finding)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('returns jwt suggestions', async () => {
      const { suggestFollowUp } = await import('../../src/intelligence/chaining')
      const finding = makeFinding({ id: 'f1', technique: 'jwt', endpoint: '/auth' })
      const suggestions = suggestFollowUp(finding)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('returns empty suggestions for unknown technique', async () => {
      const { suggestFollowUp } = await import('../../src/intelligence/chaining')
      const finding = makeFinding({ id: 'f1', technique: 'unknown-tech', endpoint: '/x' })
      const suggestions = suggestFollowUp(finding)
      expect(suggestions).toEqual([])
    })

    it('is case insensitive', async () => {
      const { suggestFollowUp } = await import('../../src/intelligence/chaining')
      const finding = makeFinding({ id: 'f1', technique: 'SQLI', endpoint: '/api' })
      const suggestions = suggestFollowUp(finding)
      expect(suggestions.length).toBeGreaterThan(0)
    })
  })
})
