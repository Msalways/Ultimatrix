import { describe, it, expect } from 'vitest'
import {
  scoreExchange,
  scoreFact,
  scoreExperiment,
  scoreFinding,
  sortByRelevance,
  estimateTokens,
  previewExchange,
  previewFact,
} from '../../src/context/selectors'

describe('scoreExchange', () => {
  it('gives base relevance for any exchange', () => {
    const score = scoreExchange({})
    expect(score).toBeGreaterThanOrEqual(0.5)
  })

  it('increases for direct endpoint match', () => {
    const score = scoreExchange({ url: 'https://example.com/api/users', endpointUrl: 'https://example.com/api/users' })
    expect(score).toBeGreaterThan(0.8)
  })

  it('increases for auth-related skills with auth responses', () => {
    const score = scoreExchange({ skillId: 'authorization', status: 200 })
    expect(score).toBeGreaterThan(0.55)
  })
})

describe('scoreFact', () => {
  it('gives higher score to endpoints and actions', () => {
    const endpoint = scoreFact({ type: 'Endpoint' })
    const finding = scoreFact({ type: 'Finding' })
    const fact = scoreFact({ type: 'Fact' })
    expect(endpoint).toBeGreaterThan(finding)
    expect(finding).toBeGreaterThan(fact)
  })

  it('increases for task-related facts', () => {
    const score = scoreFact({ type: 'Endpoint', relatedToTask: true })
    expect(score).toBeGreaterThan(0.5)
  })
})

describe('scoreExperiment', () => {
  it('increases for same hypothesis family', () => {
    const same = scoreExperiment({ sameHypothesisFamily: true })
    const diff = scoreExperiment({ sameHypothesisFamily: false })
    expect(same).toBeGreaterThan(diff)
  })
})

describe('scoreFinding', () => {
  it('increases for same endpoint and high severity', () => {
    const score = scoreFinding({ sameEndpoint: true, severity: 'critical' })
    expect(score).toBeGreaterThan(0.7)
  })
})

describe('sortByRelevance', () => {
  it('sorts descending by relevance', () => {
    const items = [
      { ref: 'a', type: 'fact', preview: 'a', relevance: 0.3 },
      { ref: 'b', type: 'fact', preview: 'b', relevance: 0.8 },
      { ref: 'c', type: 'fact', preview: 'c', relevance: 0.5 },
    ]
    const sorted = sortByRelevance(items)
    expect(sorted.map(s => s.ref)).toEqual(['b', 'c', 'a'])
  })
})

describe('estimateTokens', () => {
  it('estimates tokens from preview text', () => {
    const views = [{ ref: 'a', type: 'exchange', preview: 'GET /api/users → 200', relevance: 0.5 }]
    const tokens = estimateTokens(views)
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('previewExchange', () => {
  it('builds compact preview', () => {
    const preview = previewExchange({ method: 'GET', url: '/api/users', status: 200 })
    expect(preview).toContain('GET')
    expect(preview).toContain('/api/users')
    expect(preview).toContain('200')
  })
})

describe('previewFact', () => {
  it('builds endpoint preview', () => {
    const preview = previewFact({ type: 'Endpoint', properties: { method: 'POST', url: '/api/login' } })
    expect(preview).toContain('POST')
    expect(preview).toContain('/api/login')
  })

  it('builds finding preview', () => {
    const preview = previewFact({ type: 'Finding', properties: { severity: 'high', technique: 'sqli', endpoint: '/api/search' } })
    expect(preview).toContain('high')
    expect(preview).toContain('sqli')
  })
})
