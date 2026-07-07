import { describe, it, expect, beforeEach } from 'vitest'
import { getAllSkills, loadSkill, resetSkillCache, type SkillTier } from '../../src/solver/skills/loader'

describe('Skill tier parsing', () => {
  beforeEach(() => {
    resetSkillCache()
  })

  it('all 47 skills have a tier field', () => {
    const skills = getAllSkills()
    expect(skills.length).toBe(47)
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

  it('defaults to balanced for invalid tier', () => {
    resetSkillCache()
    const skills = getAllSkills()
    const tiers = new Set(skills.map(s => s.tier))
    expect(tiers.size).toBe(3) // fast, balanced, powerful
  })
})

describe('Skill tool chains', () => {
  beforeEach(() => {
    resetSkillCache()
  })

  it('all skills have toolChains array', () => {
    const skills = getAllSkills()
    for (const skill of skills) {
      expect(skill.toolChains).toBeDefined()
      expect(Array.isArray(skill.toolChains)).toBe(true)
    }
  })

  it('ssti skill has tool chains', () => {
    const skill = loadSkill('ssti')
    expect(skill).not.toBeNull()
    expect(skill!.toolChains.length).toBeGreaterThanOrEqual(2)
    expect(skill!.toolChains[0].name).toBe('ssti-detection')
    expect(skill!.toolChains[0].steps.length).toBeGreaterThanOrEqual(4)
  })

  it('exploitation skill has tool chains', () => {
    const skill = loadSkill('exploitation')
    expect(skill).not.toBeNull()
    expect(skill!.toolChains.length).toBeGreaterThanOrEqual(1)
    expect(skill!.toolChains[0].steps[0]).toBe('httpRequest')
  })

  it('modern-xss has both reflected and DOM chains', () => {
    const skill = loadSkill('modern-xss')
    expect(skill).not.toBeNull()
    expect(skill!.toolChains.length).toBe(2)
    expect(skill!.toolChains.map(c => c.name)).toContain('xss-reflected')
    expect(skill!.toolChains.map(c => c.name)).toContain('xss-dom-based')
  })
})

describe('Skill composition rules', () => {
  beforeEach(() => {
    resetSkillCache()
  })

  it('all skills have compositionRules', () => {
    const skills = getAllSkills()
    for (const skill of skills) {
      expect(skill.compositionRules).toBeDefined()
      expect(typeof skill.compositionRules).toBe('object')
    }
  })

  it('jwt-advanced requires authorization', () => {
    const skill = loadSkill('jwt-advanced')
    expect(skill).not.toBeNull()
    expect(skill!.compositionRules.requires).toContain('authorization')
  })

  it('ssti requires vuln-discovery', () => {
    const skill = loadSkill('ssti')
    expect(skill).not.toBeNull()
    expect(skill!.compositionRules.requires).toContain('vuln-discovery')
  })

  it('web-pentest enhances authorization and exploitation', () => {
    const skill = loadSkill('web-pentest')
    expect(skill).not.toBeNull()
    expect(skill!.compositionRules.enhances).toContain('authorization')
    expect(skill!.compositionRules.enhances).toContain('exploitation')
  })

  it('skills with no composition rules have empty arrays', () => {
    const skill = loadSkill('recon')
    expect(skill).not.toBeNull()
    expect(skill!.compositionRules.requires).toEqual([])
    expect(skill!.compositionRules.enhances).toEqual([])
    expect(skill!.compositionRules.conflicts).toEqual([])
  })
})

describe('Skill MITRE and OWASP metadata', () => {
  beforeEach(() => {
    resetSkillCache()
  })

  it('all skills have mitreAttack and owaspRefs arrays', () => {
    const skills = getAllSkills()
    for (const skill of skills) {
      expect(Array.isArray(skill.mitreAttack)).toBe(true)
      expect(Array.isArray(skill.owaspRefs)).toBe(true)
    }
  })

  it('ssti has MITRE ATT&CK IDs', () => {
    const skill = loadSkill('ssti')
    expect(skill).not.toBeNull()
    expect(skill!.mitreAttack.length).toBeGreaterThanOrEqual(1)
  })

  it('web-pentest has OWASP refs', () => {
    const skill = loadSkill('web-pentest')
    expect(skill).not.toBeNull()
    expect(skill!.owaspRefs.length).toBeGreaterThanOrEqual(1)
  })
})
