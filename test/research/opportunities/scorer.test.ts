import { describe, it, expect, beforeEach } from 'vitest'
import { scoreOpportunity, rankOpportunities } from '../../../src/research/opportunities/scorer'
import type { ResearchOpportunity } from '../../../src/research/opportunities/types'

function makeOpp(overrides: Partial<ResearchOpportunity> = {}): ResearchOpportunity {
  return {
    id: 'opp-1',
    runId: 'run-1',
    targetRef: 'https://example.com',
    title: 'Test opportunity',
    summary: 'Test',
    signal: { type: 'suspicious-endpoint', source: 'traffic' },
    evidenceRefs: [],
    artifactRefs: [],
    suggestedSkills: [],
    priority: 50,
    status: 'new',
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    seenCount: 1,
    taskRefs: [],
    candidateRefs: [],
    ...overrides,
  }
}

describe('scoreOpportunity', () => {
  it('returns base score for minimal opportunity', () => {
    const score = scoreOpportunity(makeOpp())
    expect(score).toBeGreaterThanOrEqual(35)
    expect(score).toBeLessThanOrEqual(65)
  })

  it('increases with suggested skill score', () => {
    const opp = makeOpp({
      suggestedSkills: [{ skillId: 'authorization', score: 90, reason: 'auth endpoint' }],
    })
    const score = scoreOpportunity(opp)
    expect(score).toBeGreaterThan(50)
  })

  it('increases with repeated observations', () => {
    const opp1 = makeOpp({ seenCount: 1 })
    const opp3 = makeOpp({ seenCount: 5 })
    expect(scoreOpportunity(opp3)).toBeGreaterThan(scoreOpportunity(opp1))
  })

  it('increases with evidence strength', () => {
    const score = scoreOpportunity(makeOpp(), { evidenceStrength: 0.9 })
    expect(score).toBeGreaterThan(50)
  })

  it('decreases when proven benign', () => {
    const score = scoreOpportunity(makeOpp(), { provenBenign: true })
    expect(score).toBeLessThan(50)
  })

  it('decreases when already tested', () => {
    const score = scoreOpportunity(makeOpp(), { alreadyTested: true })
    expect(score).toBeLessThan(50)
  })

  it('decreases for insufficient signal', () => {
    const oppWithEvidence = makeOpp({ evidenceRefs: ['ev-1'], seenCount: 1 })
    const oppWithout = makeOpp({ evidenceRefs: [], seenCount: 1 })
    const scoreWith = scoreOpportunity(oppWithEvidence)
    const scoreWithout = scoreOpportunity(oppWithout)
    expect(scoreWithout).toBeLessThan(scoreWith)
  })

  it('stays within 0-100 bounds', () => {
    const opp = makeOpp({
      suggestedSkills: [{ skillId: 'auth', score: 100, reason: 'test' }],
      seenCount: 10,
      evidenceRefs: ['ev-1'],
    })
    const score = scoreOpportunity(opp, { evidenceStrength: 1.0, provenBenign: true, alreadyTested: true })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('rankOpportunities', () => {
  it('ranks by score descending', () => {
    const opps = [
      makeOpp({ id: 'low', seenCount: 1 }),
      makeOpp({ id: 'high', seenCount: 5, suggestedSkills: [{ skillId: 'auth', score: 90, reason: 'test' }] }),
      makeOpp({ id: 'mid', seenCount: 3 }),
    ]

    const ranked = rankOpportunities(opps)
    // High should be first (has suggested skill + repeated observations)
    expect(ranked[0].opportunity.id).toBe('high')
    // All scores should be in descending order
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
    }
  })

  it('returns all opportunities', () => {
    const opps = [makeOpp({ id: 'a' }), makeOpp({ id: 'b' })]
    const ranked = rankOpportunities(opps)
    expect(ranked).toHaveLength(2)
  })
})
