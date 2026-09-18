import { describe, it, expect, beforeEach } from 'vitest'
import { generatePivots, promotePivotsToOpportunities } from '../../../src/research/pivots/generator'
import { clearOpportunities, getByRun } from '../../../src/research/opportunities/store'
import type { ResearchCase } from '../../../src/research/cases/types'

function makeCase(overrides: Partial<ResearchCase> = {}): ResearchCase {
  return {
    id: 'case-1',
    domain: 'authorization',
    initialHypothesis: 'IDOR on /api/users',
    contextFeatures: ['skill:authorization'],
    decisiveEvidence: [],
    counterEvidence: ['no response difference'],
    outcome: 'rejected',
    falsePositiveReason: 'shared resource between actors',
    sourceRefs: ['ev-1'],
    ...overrides,
  }
}

describe('generatePivots', () => {
  it('generates pivots for rejected hypotheses', () => {
    const pivots = generatePivots(makeCase(), {
      relatedEndpoints: ['/api/v2/users', '/api/admin/users'],
    })

    expect(pivots.length).toBeGreaterThan(0)
    // Should suggest adjacent endpoints
    expect(pivots.some(p => p.title.includes('adjacent'))).toBe(true)
  })

  it('generates escalation pivots for validated findings', () => {
    const caseData = makeCase({ outcome: 'validated', decisiveEvidence: ['response difference'] })
    const pivots = generatePivots(caseData)

    expect(pivots.length).toBeGreaterThan(0)
    expect(pivots.some(p => p.title.includes('escalation'))).toBe(true)
  })

  it('does not generate pivots for inconclusive cases', () => {
    const caseData = makeCase({ outcome: 'inconclusive' })
    const pivots = generatePivots(caseData)
    expect(pivots).toHaveLength(0)
  })

  it('pivot does not auto-grant capabilities', () => {
    const pivots = generatePivots(makeCase())
    for (const pivot of pivots) {
      // Pivots only suggest skills, they don't execute
      expect(pivot.suggestedSkills).toBeInstanceOf(Array)
    }
  })

  it('pivot references source evidence', () => {
    const caseData = makeCase({ sourceRefs: ['ev-1', 'ev-2'] })
    const pivots = generatePivots(caseData)
    for (const pivot of pivots) {
      expect(pivot.sourceRefs).toContain('ev-1')
    }
  })
})

describe('promotePivotsToOpportunities', () => {
  beforeEach(() => {
    clearOpportunities()
  })

  it('creates opportunities from pivots', () => {
    const pivots = generatePivots(makeCase(), {
      relatedEndpoints: ['/api/v2/users'],
    })

    const opps = promotePivotsToOpportunities('run-1', 'https://example.com', pivots)
    expect(opps.length).toBeGreaterThan(0)

    const storedOpps = getByRun('run-1')
    expect(storedOpps.length).toBe(opps.length)
  })

  it('opportunities have pivot as source', () => {
    const pivots = generatePivots(makeCase(), {
      relatedEndpoints: ['/api/v2/users'],
    })

    const opps = promotePivotsToOpportunities('run-1', 'https://example.com', pivots)
    for (const opp of opps) {
      expect(opp.signal.source).toBe('pivot')
    }
  })
})
