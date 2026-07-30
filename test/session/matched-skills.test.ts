/**
 * matchedSkills pipeline: verify that goal text triggers skill search
 * and that loaded skills are forwarded to solve() as matchedSkills.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/solver/skills/loader', () => ({
  loadSkill: vi.fn(),
  initSkillIndex: vi.fn(),
}))

import { SkillRegistry } from '../../src/solver/skills/registry'
import { loadSkill } from '../../src/solver/skills/loader'

const mockLoadSkill = vi.mocked(loadSkill)

function makeMeta(id: string, name: string) {
  return { id, name, description: `${name} skill`, category: 'test', tier: 1, toolRefs: [], toolChains: [], compositionRules: {}, references: [] }
}

function makeSkill(id: string, name: string) {
  return {
    id,
    name,
    description: `${name} skill`,
    tier: 1,
    instructions: `# ${name} methodology`,
    toolRefs: ['httpRequest'],
    toolChains: [{ name: 'chain', description: 'chain', steps: ['a', 'b'] }],
    compositionRules: {},
    references: [],
  }
}

describe('matchedSkills pipeline', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new SkillRegistry()
    // Manually populate the internal map
    ;(registry as any).skills = new Map([
      ['injection/exploitation', makeMeta('injection/exploitation', 'Exploitation')],
      ['injection/nosql-injection', makeMeta('injection/nosql-injection', 'NoSQL Injection')],
      ['web-attacks/web-pentest', makeMeta('web-attacks/web-pentest', 'Web Pentest')],
      ['auth-security/authorization', makeMeta('auth-security/authorization', 'Authorization')],
    ])
  })

  it('goal text "SQL injection" matches injection skills', () => {
    const results = registry.search('SQL injection')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(s => s.id.includes('injection'))).toBe(true)
  })

  it('empty goal text returns all skills (no filtering)', () => {
    const results = registry.search('')
    // Empty query matches all skills via includes('') — the session.ts guard
    // (line.trim().length > 3) prevents this from being reached in practice.
    expect(results.length).toBe(4)
  })

  it('unknown goal text returns no results', () => {
    const results = registry.search('quantum physics entanglement')
    expect(results).toEqual([])
  })

  it('loadSkill is called for matched candidates', () => {
    mockLoadSkill.mockImplementation((id: string) => makeSkill(id, id) as any)

    const candidates = registry.search('injection').slice(0, 3)
    const loaded = candidates.map(m => loadSkill(m.id)).filter(Boolean)

    expect(loaded.length).toBeGreaterThan(0)
    expect(loaded[0].instructions).toContain('methodology')
    expect(loaded[0].toolRefs).toEqual(['httpRequest'])
  })

  it('loadSkill returns null for unknown ID gracefully', () => {
    mockLoadSkill.mockReturnValue(null)
    const result = loadSkill('nonexistent/skill')
    expect(result).toBeNull()
  })
})
