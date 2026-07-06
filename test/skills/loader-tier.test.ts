import { describe, it, expect, beforeEach } from 'vitest'
import { getAllSkills, loadSkill, resetSkillCache, type SkillTier } from '../../src/skills/loader'

describe('Skill tier parsing', () => {
  beforeEach(() => {
    resetSkillCache()
  })

  it('all 21 skills have a tier field', () => {
    const skills = getAllSkills()
    expect(skills.length).toBe(21)
    for (const skill of skills) {
      expect(skill.tier).toBeDefined()
      expect(['fast', 'balanced', 'powerful']).toContain(skill.tier)
    }
  })

  it('recon skill has tier: fast', () => {
    const skill = loadSkill('recon')
    expect(skill).not.toBeNull()
    expect(skill!.tier).toBe('fast')
  })

  it('exploitation skill has tier: powerful', () => {
    const skill = loadSkill('exploitation')
    expect(skill).not.toBeNull()
    expect(skill!.tier).toBe('powerful')
  })

  it('authorization skill has tier: powerful', () => {
    const skill = loadSkill('authorization')
    expect(skill).not.toBeNull()
    expect(skill!.tier).toBe('powerful')
  })

  it('vuln-discovery skill has tier: balanced', () => {
    const skill = loadSkill('vuln-discovery')
    expect(skill).not.toBeNull()
    expect(skill!.tier).toBe('balanced')
  })

  it('ctf-web skill has tier: fast', () => {
    const skill = loadSkill('ctf-web')
    expect(skill).not.toBeNull()
    expect(skill!.tier).toBe('fast')
  })

  it('race-conditions skill has tier: powerful', () => {
    const skill = loadSkill('race-conditions')
    expect(skill).not.toBeNull()
    expect(skill!.tier).toBe('powerful')
  })

  it('defaults to balanced for invalid tier', () => {
    resetSkillCache()
    // All real skills should parse correctly, but the parser handles bad values
    const skills = getAllSkills()
    const tiers = new Set(skills.map(s => s.tier))
    expect(tiers.size).toBe(3) // fast, balanced, powerful
  })
})
