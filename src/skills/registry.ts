import { loadAllSkills, type Skill } from './loader'

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map()

  loadFromDirectory(dir: string): void {
    const skills = loadAllSkills(dir)
    for (const skill of skills) {
      this.skills.set(skill.id, skill)
    }
  }

  get(skillId: string): Skill {
    const skill = this.skills.get(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)
    return skill
  }

  has(skillId: string): boolean {
    return this.skills.has(skillId)
  }

  search(query: string): Skill[] {
    const q = query.toLowerCase()
    const results: Array<{ skill: Skill; score: number }> = []

    for (const skill of this.skills.values()) {
      let score = 0
      if (skill.id.toLowerCase().includes(q)) score += 10
      if (skill.name.toLowerCase().includes(q)) score += 8
      if (skill.description.toLowerCase().includes(q)) score += 5
      for (const tag of skill.tags) {
        if (tag.toLowerCase().includes(q)) score += 4
      }
      if (skill.instructions.toLowerCase().includes(q)) score += 2
      if (skill.toolRefs.some(t => t.toLowerCase().includes(q))) score += 3
      if (skill.mitreAttack?.some(m => m.toLowerCase().includes(q))) score += 3

      if (score > 0) results.push({ skill, score })
    }

    return results.sort((a, b) => b.score - a.score).map(r => r.skill)
  }

  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  count(): number {
    return this.skills.size
  }
}

export * from './loader'
