import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry, type GraphSummary, type SkillMatchContext } from '../../src/solver/skills/registry'
import { resetSkillCache } from '../../src/solver/skills/loader'

function makeGraphSummary(overrides?: Partial<GraphSummary>): GraphSummary {
  return {
    endpointCount: 10,
    findingCount: 2,
    authFlowCount: 1,
    attackPathCount: 0,
    untestedEndpoints: 5,
    recentFindings: [],
    hasAuth: true,
    hasSQL: false,
    hasGraphQL: false,
    hasFileUpload: false,
    ...overrides,
  }
}

describe('SkillRegistry — target-aware matching', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    resetSkillCache()
    registry = new SkillRegistry()
    registry.loadFromDirectory('')
  })

  it('matches skills by keyword (baseline)', () => {
    const matches = registry.matchSkills('reconnaissance and fingerprinting')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].skill.id).toBe('recon')
    expect(matches[0].matchReasons.some(r => r.startsWith('keyword'))).toBe(true)
  })

  it('returns empty for unrelated input', () => {
    const matches = registry.matchSkills('zzzznonexistent')
    expect(matches.length).toBe(0)
  })

  it('boosts authorization skill when graph has auth flows', () => {
    const withAuth = registry.matchSkills('test access control', {
      graphSummary: makeGraphSummary({ hasAuth: true, authFlowCount: 3 }),
    })
    const withoutAuth = registry.matchSkills('test access control', {
      graphSummary: makeGraphSummary({ hasAuth: false, authFlowCount: 0 }),
    })

    const authWith = withAuth.find(m => m.skill.id === 'authorization')
    const authWithout = withoutAuth.find(m => m.skill.id === 'authorization')

    expect(authWith).toBeDefined()
    expect(authWithout).toBeDefined()
    expect(authWith!.matchScore).toBeGreaterThan(authWithout!.matchScore)
  })

  it('boosts vuln-discovery when graph has SQL endpoints', () => {
    const matches = registry.matchSkills('test for injection', {
      graphSummary: makeGraphSummary({ hasSQL: true }),
    })
    const vuln = matches.find(m => m.skill.id === 'vuln-discovery')
    expect(vuln).toBeDefined()
    expect(vuln!.matchReasons.some(r => r.includes('sqli') || r.includes('SQL'))).toBe(true)
  })

  it('boosts web-pentest for XSS goal', () => {
    const matches = registry.matchSkills('test the app', {
      goal: 'Find XSS vulnerabilities in search functionality',
    })
    const web = matches.find(m => m.skill.id === 'web-pentest')
    expect(web).toBeDefined()
    expect(web!.matchReasons.some(r => r.includes('XSS'))).toBe(true)
  })

  it('penalizes recently used skills (diversity)', () => {
    const first = registry.matchSkills('recon', {
      previousSkills: ['recon'],
    })
    const second = registry.matchSkills('recon', {
      previousSkills: ['recon', 'recon', 'recon'],
    })

    const reconFirst = first.find(m => m.skill.id === 'recon')
    const reconSecond = second.find(m => m.skill.id === 'recon')

    expect(reconFirst).toBeDefined()
    expect(reconSecond).toBeDefined()
    expect(reconSecond!.matchScore).toBeLessThan(reconFirst!.matchScore)
  })

  it('aligns complexity with tier', () => {
    const critical = registry.matchSkills('test the app', {
      taskComplexity: 'critical',
    })
    const low = registry.matchSkills('test the app', {
      taskComplexity: 'low',
    })

    // Critical should favor powerful-tier skills
    const powerfulCritical = critical.find(m => m.skill.tier === 'powerful')
    const powerfulLow = low.find(m => m.skill.tier === 'powerful')

    if (powerfulCritical && powerfulLow) {
      expect(powerfulCritical.matchScore).toBeGreaterThanOrEqual(powerfulLow.matchScore)
    }
  })

  it('matchScore sorts descending', () => {
    const matches = registry.matchSkills('recon')
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].matchScore).toBeGreaterThanOrEqual(matches[i].matchScore)
    }
  })

  it('all matches have matchReasons array', () => {
    const matches = registry.matchSkills('exploitation')
    for (const match of matches) {
      expect(Array.isArray(match.matchReasons)).toBe(true)
      expect(match.matchReasons.length).toBeGreaterThan(0)
    }
  })

  it('search still works (backward compatible)', () => {
    const results = registry.search('recon')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('recon')
  })
})
