import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  addReflexion: vi.fn(),
  queryNodes: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

import { saveReflexionState, loadRelevantHints } from '../../src/intelligence/reflexion-store'
import { ReflexionEngine, FailureCategory } from '../../src/intelligence/reflexion'

describe('reflexion-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.queryNodes.mockReturnValue([])
  })

  describe('saveReflexionState', () => {
    it('creates a ReflexionNode in the graph', () => {
      const engine = new ReflexionEngine()
      engine.recordAttempt('/api', false, FailureCategory.ENV_CONSTRAINT, 'WAF blocked', 'sqli')
      engine.recordAttempt('/api', false, FailureCategory.ENV_CONSTRAINT, 'WAF blocked', 'sqli')

      saveReflexionState(engine, 'worker-1')

      expect(mockStore.addReflexion).toHaveBeenCalledTimes(1)
      const data = mockStore.addReflexion.mock.calls[0][0]
      expect(data.workerId).toBe('worker-1')
      expect(data.vulnType).toBe('sqli')
      expect(data.failedPaths).toContain('/api')
      expect(data.hints).toContain('WAF blocked')
    })

    it('saves the graph asynchronously', () => {
      const engine = new ReflexionEngine()
      saveReflexionState(engine, 'worker-2')

      expect(mockStore.save).toHaveBeenCalled()
    })

    it('passes targetOrigin when provided', () => {
      const engine = new ReflexionEngine()
      engine.recordAttempt('/api', false, FailureCategory.ENV_CONSTRAINT, 'WAF blocked', 'sqli')

      saveReflexionState(engine, 'worker-3', 'example.com')

      const data = mockStore.addReflexion.mock.calls[0][0]
      expect(data.targetOrigin).toBe('example.com')
    })
  })

  describe('loadRelevantHints', () => {
    it('returns hints matching the vuln type', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: {
            workerId: 'w1',
            vulnType: 'sqli',
            hints: ['WAF detected', 'Try encoding'],
          },
        },
        {
          type: 'Reflexion',
          properties: {
            workerId: 'w2',
            vulnType: 'xss',
            hints: ['CSP header present'],
          },
        },
      ])

      const hints = loadRelevantHints('sqli')
      expect(hints).toContain('WAF detected')
      expect(hints).toContain('Try encoding')
      expect(hints).not.toContain('CSP header present')
    })

    it('includes hints from nodes with empty vulnType', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: {
            workerId: 'w1',
            vulnType: '',
            hints: ['General hint'],
          },
        },
      ])

      const hints = loadRelevantHints('sqli')
      expect(hints).toContain('General hint')
    })

    it('deduplicates hints', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: { workerId: 'w1', vulnType: 'sqli', hints: ['WAF detected'] },
        },
        {
          type: 'Reflexion',
          properties: { workerId: 'w2', vulnType: 'sqli', hints: ['WAF detected'] },
        },
      ])

      const hints = loadRelevantHints('sqli')
      expect(hints).toEqual(['WAF detected'])
    })

    it('returns empty for unknown vuln type', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: { workerId: 'w1', vulnType: 'xss', hints: ['CSP'] },
        },
      ])

      const hints = loadRelevantHints('xxe')
      expect(hints).toEqual([])
    })

    it('returns empty when no reflexion nodes exist', () => {
      mockStore.queryNodes.mockReturnValue([])
      const hints = loadRelevantHints('sqli')
      expect(hints).toEqual([])
    })

    it('handles nodes with non-array hints gracefully', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: { workerId: 'w1', vulnType: 'sqli', hints: 'not-an-array' },
        },
      ])

      const hints = loadRelevantHints('sqli')
      expect(hints).toEqual([])
    })

    it('filters by targetOrigin when provided', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: { workerId: 'w1', vulnType: 'sqli', hints: ['WAF detected'], targetOrigin: 'example.com' },
        },
        {
          type: 'Reflexion',
          properties: { workerId: 'w2', vulnType: 'sqli', hints: ['Different WAF'], targetOrigin: 'other.com' },
        },
      ])

      const hints = loadRelevantHints('sqli', 'example.com')
      expect(hints).toContain('WAF detected')
      expect(hints).not.toContain('Different WAF')
    })

    it('includes hints without targetOrigin when filtering', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: { workerId: 'w1', vulnType: 'sqli', hints: ['No origin hint'] },
        },
        {
          type: 'Reflexion',
          properties: { workerId: 'w2', vulnType: 'sqli', hints: ['Other origin'], targetOrigin: 'other.com' },
        },
      ])

      const hints = loadRelevantHints('sqli', 'example.com')
      expect(hints).toContain('No origin hint')
      expect(hints).not.toContain('Other origin')
    })

    it('returns all hints when targetOrigin is not provided', () => {
      mockStore.queryNodes.mockReturnValue([
        {
          type: 'Reflexion',
          properties: { workerId: 'w1', vulnType: 'sqli', hints: ['Hint A'], targetOrigin: 'example.com' },
        },
        {
          type: 'Reflexion',
          properties: { workerId: 'w2', vulnType: 'sqli', hints: ['Hint B'], targetOrigin: 'other.com' },
        },
      ])

      const hints = loadRelevantHints('sqli')
      expect(hints).toContain('Hint A')
      expect(hints).toContain('Hint B')
    })
  })
})
