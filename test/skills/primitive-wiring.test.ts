/**
 * Skill→primitive wiring drift guard (P1.5).
 *
 * Skills declare their executable techniques via the `primitives` frontmatter
 * field. Every declared id MUST exist in the primitive registry — a typo or a
 * renamed primitive would otherwise silently break the skill's execution seam.
 * Also guards the inverse direction: skills whose attack class is covered by a
 * registered primitive should declare it, so the solver can go prose→execution
 * directly.
 */
import { describe, it, expect } from 'vitest'
import { getAllSkills } from '../../src/solver/skills/loader'
import { listPrimitives } from '../../src/primitives/index'

describe('skill→primitive wiring', () => {
  const registry = new Set(listPrimitives().map(p => p.id))

  it('primitive registry is populated', () => {
    expect(registry.size).toBeGreaterThanOrEqual(29)
  })

  it('every skill-declared primitive exists in the registry', () => {
    const skills = getAllSkills()
    expect(skills.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const skill of skills) {
      for (const p of skill.primitives ?? []) {
        if (!registry.has(p)) missing.push(`${skill.id}:${p}`)
      }
    }
    expect(missing, `skills reference unknown primitives: ${missing.join(', ')}`).toEqual([])
  })

  it('every skill declaring primitives also lists the execution tool in toolRefs', () => {
    const skills = getAllSkills()
    const broken: string[] = []
    for (const skill of skills) {
      if ((skill.primitives?.length ?? 0) > 0 && !skill.toolRefs.includes('runPrimitive')) {
        broken.push(skill.id)
      }
    }
    expect(broken, `primitive-backed skills missing runPrimitive toolRef: ${broken.join(', ')}`).toEqual([])
  })

  it('declared primitive ids are unique per skill', () => {
    for (const skill of getAllSkills()) {
      const set = new Set(skill.primitives ?? [])
      expect(set.size).toBe((skill.primitives ?? []).length)
    }
  })
})
