import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDoneIndex } from '../../src/solver/done-index'

function makeMockGraph() {
  return {
    queryNodes: vi.fn().mockReturnValue([]),
  }
}

function makeMockBlackboard() {
  return {
    getSummary: vi.fn().mockReturnValue({
      planTotal: 0,
      planCounts: {},
    }),
  }
}

describe('buildDoneIndex', () => {
  let mockGraph: ReturnType<typeof makeMockGraph>
  let mockBlackboard: ReturnType<typeof makeMockBlackboard>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGraph = makeMockGraph()
    mockBlackboard = makeMockBlackboard()
  })

  it('lists tested endpoints with techniques', () => {
    mockGraph.queryNodes.mockImplementation((type?: string) => {
      if (type === 'Finding') return [
        { properties: { endpoint: '/api/users', technique: 'xss' } },
        { properties: { endpoint: '/api/users', technique: 'idor' } },
        { properties: { endpoint: '/api/login', technique: 'brute-force' } },
      ]
      if (type === 'Endpoint') return [
        { properties: { url: '/api/users', method: 'GET' } },
        { properties: { url: '/api/login', method: 'POST' } },
      ]
      return []
    })

    const result = buildDoneIndex(mockGraph as any, mockBlackboard as any)
    expect(result).toContain('Tested Endpoints:')
    expect(result).toContain('/api/users')
    expect(result).toContain('xss')
    expect(result).toContain('idor')
    expect(result).toContain('/api/login')
    expect(result).toContain('brute-force')
  })

  it('lists untested endpoints', () => {
    mockGraph.queryNodes.mockImplementation((type?: string) => {
      if (type === 'Endpoint') return [
        { properties: { url: '/api/users', method: 'GET' } },
        { properties: { url: '/api/admin', method: 'GET' } },
      ]
      return []
    })

    const result = buildDoneIndex(mockGraph as any, mockBlackboard as any)
    expect(result).toContain('Untested')
    expect(result).toContain('/api/admin')
  })

  it('lists failed approaches', () => {
    mockGraph.queryNodes.mockImplementation((type?: string) => {
      if (type === 'Reflexion') return [
        { properties: { vulnType: 'sqli', failureCategory: 'waf-blocked' } },
      ]
      return []
    })

    const result = buildDoneIndex(mockGraph as any, mockBlackboard as any)
    expect(result).toContain('Failed')
    expect(result).toContain('sqli')
    expect(result).toContain('waf-blocked')
  })

  it('shows plan progress', () => {
    mockBlackboard.getSummary.mockReturnValue({
      planTotal: 10,
      planCounts: { done: 3, skip: 1 },
    })

    const result = buildDoneIndex(mockGraph as any, mockBlackboard as any)
    expect(result).toContain('Plan:')
    expect(result).toContain('4/10')
  })

  it('lists attack outcomes', () => {
    mockGraph.queryNodes.mockImplementation((type?: string) => {
      if (type === 'Attack') return [
        { properties: { technique: 'xss', vulnerable: true } },
        { properties: { technique: 'sqli', vulnerable: false } },
      ]
      return []
    })

    const result = buildDoneIndex(mockGraph as any, mockBlackboard as any)
    expect(result).toContain('Attacks:')
    expect(result).toContain('xss [VULN]')
    expect(result).toContain('sqli [safe]')
  })

  it('respects token budget', () => {
    mockGraph.queryNodes.mockImplementation((type?: string) => {
      if (type === 'Endpoint') return Array.from({ length: 100 }, (_, i) => ({
        properties: { url: `/api/endpoint-${i}`, method: 'GET' },
      }))
      return []
    })

    const result = buildDoneIndex(mockGraph as any, mockBlackboard as any, 50)
    const estimatedTokens = Math.ceil(result.length / 4)
    expect(estimatedTokens).toBeLessThanOrEqual(60) // Small margin for header text
  })

  it('handles empty graph gracefully', () => {
    const result = buildDoneIndex(mockGraph as any, mockBlackboard as any)
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
  })
})
