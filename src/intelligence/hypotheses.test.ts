import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Hypothesis } from './hypotheses'

const mockStore = {
  queryNodes: vi.fn(),
  getUntestedActions: vi.fn(),
}

vi.mock('../graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

function makePage(id: string, url: string, requiresAuth = false) {
  return {
    id,
    type: 'Page',
    label: `Page: ${url}`,
    properties: { url, requiresAuth, method: 'GET', tags: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function makeAction(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    type: 'Action',
    label: 'Action',
    properties: {
      actionType: 'click',
      url: '',
      selector: '',
      value: '',
      naturalLanguage: '',
      ...overrides,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('HypothesesGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateHypotheses', () => {
    it('generates hypotheses from untested actions and pages', async () => {
      const { generateHypotheses } = await import('./hypotheses')
      const page = makePage('page:http://test.com', 'http://test.com')
      const action = makeAction('action:page:http://test.com:fill:123', {
        actionType: 'fill',
        url: 'http://test.com/api/login',
        selector: '#email',
      })

      mockStore.queryNodes.mockReturnValue([page])
      mockStore.getUntestedActions.mockReturnValue([action])

      const hypotheses = generateHypotheses()
      expect(hypotheses.length).toBeGreaterThanOrEqual(2)
      const techniques = hypotheses.map(h => h.technique)
      expect(techniques).toContain('xss')
      expect(techniques).toContain('sqli')
    })

    it('generates api-security hypothesis for API endpoints', async () => {
      const { generateHypotheses } = await import('./hypotheses')
      const page = makePage('page:http://test.com', 'http://test.com/api/users')
      const action = makeAction('action:page:http://test.com:click:123', {
        actionType: 'click',
        url: 'http://test.com/api/users',
      })

      mockStore.queryNodes.mockReturnValue([page])
      mockStore.getUntestedActions.mockReturnValue([action])

      const hypotheses = generateHypotheses()
      expect(hypotheses.some(h => h.technique === 'api-security')).toBe(true)
    })

    it('generates business-logic hypothesis for click actions', async () => {
      const { generateHypotheses } = await import('./hypotheses')
      const page = makePage('page:http://test.com', 'http://test.com')
      const action = makeAction('action:page:http://test.com:click:123', {
        actionType: 'click',
        url: 'http://test.com/button',
      })

      mockStore.queryNodes.mockReturnValue([page])
      mockStore.getUntestedActions.mockReturnValue([action])

      const hypotheses = generateHypotheses()
      expect(hypotheses.some(h => h.technique === 'business-logic')).toBe(true)
    })

    it('generates auth-bypass hypothesis for auth-gated pages', async () => {
      const { generateHypotheses } = await import('./hypotheses')
      const page = makePage('page:http://test.com/admin', 'http://test.com/admin', true)

      mockStore.queryNodes.mockReturnValue([page])
      mockStore.getUntestedActions.mockReturnValue([])

      const hypotheses = generateHypotheses()
      expect(hypotheses.some(h => h.technique === 'auth-bypass')).toBe(true)
    })

    it('returns sorted by priority descending', async () => {
      const { generateHypotheses } = await import('./hypotheses')
      const page = makePage('page:http://test.com/api', 'http://test.com/api')
      const action = makeAction('action:page:http://test.com:fill:123', {
        actionType: 'fill',
        url: 'http://test.com/api/login',
      })

      mockStore.queryNodes.mockReturnValue([page])
      mockStore.getUntestedActions.mockReturnValue([action])

      const hypotheses = generateHypotheses()
      for (let i = 1; i < hypotheses.length; i++) {
        expect(hypotheses[i].priority).toBeLessThanOrEqual(hypotheses[i - 1].priority)
      }
    })

    it('returns empty array when no pages or actions', async () => {
      const { generateHypotheses } = await import('./hypotheses')
      mockStore.queryNodes.mockReturnValue([])
      mockStore.getUntestedActions.mockReturnValue([])

      const hypotheses = generateHypotheses()
      expect(hypotheses).toEqual([])
    })
  })

  describe('prioritizeHypotheses', () => {
    it('partitions into breadth, depth, and pivot', async () => {
      const { prioritizeHypotheses } = await import('./hypotheses')
      const hypotheses: Hypothesis[] = [
        { id: 'h-1', technique: 'xss', endpointId: 'a1', endpointUrl: '/search', priority: 2, description: 'test xss' },
        { id: 'h-2', technique: 'sqli', endpointId: 'a2', endpointUrl: '/api', priority: 3, description: 'test sqli' },
        { id: 'h-3', technique: 'xss', endpointId: 'a3', endpointUrl: '/other', priority: 1, description: 'another xss' },
        { id: 'h-4', technique: 'auth-bypass', endpointId: 'p1', endpointUrl: '/admin', priority: 3, description: 'test auth' },
      ]

      const result = prioritizeHypotheses(hypotheses)
      // breadth: one per technique
      expect(result.breadth.length).toBe(3)
      // depth: priority >= 2
      expect(result.depth.length).toBe(3)
      // pivot: priority >= 3
      expect(result.pivot.length).toBe(2)
    })

    it('handles empty array', async () => {
      const { prioritizeHypotheses } = await import('./hypotheses')
      const result = prioritizeHypotheses([])
      expect(result.breadth).toEqual([])
      expect(result.depth).toEqual([])
      expect(result.pivot).toEqual([])
    })

    it('breadth picks first technique occurrence only', async () => {
      const { prioritizeHypotheses } = await import('./hypotheses')
      const hypotheses: Hypothesis[] = [
        { id: 'h-1', technique: 'xss', endpointId: 'a1', endpointUrl: '/a', priority: 1, description: 'first xss' },
        { id: 'h-2', technique: 'xss', endpointId: 'a2', endpointUrl: '/b', priority: 2, description: 'second xss' },
      ]
      const result = prioritizeHypotheses(hypotheses)
      expect(result.breadth).toHaveLength(1)
      expect(result.breadth[0].id).toBe('h-1')
    })
  })
})
