import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/skills/loader', () => ({
  loadSkill: vi.fn(),
  searchSkills: vi.fn(),
}))

import { dispatch } from '../../src/skills/dispatcher'
import { loadSkill, searchSkills } from '../../src/skills/loader'

const mockLoadSkill = vi.mocked(loadSkill)
const mockSearchSkills = vi.mocked(searchSkills)

const pentestSkill = {
  id: 'pentest-flow',
  name: 'Pentest Flow',
  category: 'core' as const,
  description: 'Penetration testing flow',
  instructions: 'test instructions',
  references: [],
  toolRefs: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadSkill.mockImplementation((id: string) => {
    if (id === 'pentest-flow') return pentestSkill
    return null
  })
  mockSearchSkills.mockReturnValue([])
})

describe('dispatch', () => {
  it('routes SQL injection keywords to pentest-flow', () => {
    const result = dispatch('test sql injection payload')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('sql injection')
  })

  it('routes sqli keyword to pentest-flow', () => {
    const result = dispatch('use sqli on this endpoint')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('sql injection')
  })

  it('routes XSS keywords to pentest-flow', () => {
    const result = dispatch('check for xss vulnerabilities')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('xss')
  })

  it('routes cross-site scripting keywords to pentest-flow', () => {
    const result = dispatch('test cross-site scripting')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('xss')
  })

  it('routes auth keywords to pentest-flow', () => {
    const result = dispatch('test jwt token validation')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('jwt')
  })

  it('routes privilege escalation keywords to pentest-flow', () => {
    const result = dispatch('attempt privilege escalation')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('idor')
  })

  it('routes race condition keywords to pentest-flow', () => {
    const result = dispatch('test for race condition in checkout')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('race condition')
  })

  it('routes SSRF keywords to pentest-flow', () => {
    const result = dispatch('try ssrf on webhook endpoint')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('ssrf')
  })

  it('routes command injection keywords to pentest-flow', () => {
    const result = dispatch('test command injection via ping')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('command injection')
  })

  it('routes recon keywords to pentest-flow', () => {
    const result = dispatch('start recon on target')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('recon')
  })

  it('routes information disclosure keywords to pentest-flow', () => {
    const result = dispatch('check for information disclosure')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('information disclosure')
  })

  it('returns empty result for empty input', () => {
    const result = dispatch('')
    expect(result.skills).toHaveLength(0)
    expect(result.matchedRoutes).toHaveLength(0)
  })

  it('falls back to keyword search when no route matches', () => {
    mockSearchSkills.mockReturnValue([pentestSkill])
    const result = dispatch('some random query xyz')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toEqual(['keyword_search'])
    expect(mockSearchSkills).toHaveBeenCalledWith('some random query xyz')
  })

  it('returns empty when no route matches and search yields nothing', () => {
    mockSearchSkills.mockReturnValue([])
    const result = dispatch('some random query xyz')
    expect(result.skills).toHaveLength(0)
    expect(result.matchedRoutes).toHaveLength(0)
  })

  it('deduplicates skills when multiple patterns match', () => {
    const result = dispatch('test sql injection and xss vulnerabilities')
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0].id).toBe('pentest-flow')
    expect(result.matchedRoutes).toContain('sql injection')
    expect(result.matchedRoutes).toContain('xss')
  })

  it('matches case-insensitively', () => {
    const result = dispatch('TEST SQL INJECTION PAYLOAD')
    expect(result.skills).toContainEqual(pentestSkill)
    expect(result.matchedRoutes).toContain('sql injection')
  })

  it('limits keyword search fallback to 3 results', () => {
    const manySkills = Array.from({ length: 5 }, (_, i) => ({
      id: `skill-${i}`,
      name: `Skill ${i}`,
      category: 'core' as const,
      description: `Skill ${i}`,
      instructions: '',
      references: [],
      toolRefs: [],
    }))
    mockSearchSkills.mockReturnValue(manySkills)
    const result = dispatch('unknown query')
    expect(result.skills).toHaveLength(3)
  })
})
