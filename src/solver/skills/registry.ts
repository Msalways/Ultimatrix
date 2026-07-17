import { getAllSkills, loadSkill, initSkillIndex, type Skill, type SkillMeta } from './loader'

export interface GraphSummary {
  endpointCount: number
  findingCount: number
  authFlowCount: number
  attackPathCount: number
  untestedEndpoints: number
  recentFindings: string[]
  hasAuth: boolean
  hasSQL: boolean
  hasGraphQL: boolean
  hasFileUpload: boolean
}

export interface SkillMatchContext {
  graphSummary?: GraphSummary
  goal?: string
  previousSkills?: string[]
  taskComplexity?: string
}

export interface SkillMatch {
  skill: SkillMeta
  matchScore: number
  matchReasons: string[]
}

export class SkillRegistry {
  private skills: Map<string, SkillMeta> = new Map()
  private recentSkillCounts: Map<string, number> = new Map()

  loadFromDirectory(_dir: string): void {
    const allSkills = initSkillIndex()
    for (const [id, meta] of allSkills) {
      this.skills.set(id, meta)
    }
  }

  get(skillId: string): SkillMeta {
    const skill = this.skills.get(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)
    return skill
  }

  has(skillId: string): boolean {
    return this.skills.has(skillId)
  }

  search(query: string): SkillMeta[] {
    const q = query.toLowerCase()
    const results: Array<{ skill: SkillMeta; score: number }> = []

    for (const skill of this.skills.values()) {
      let score = 0
      if (skill.id.toLowerCase().includes(q)) score += 10
      if (skill.name.toLowerCase().includes(q)) score += 8
      if (skill.description.toLowerCase().includes(q)) score += 5
      if (skill.toolRefs.some(t => t.toLowerCase().includes(q))) score += 3

      if (score > 0) results.push({ skill, score })
    }

    return results.sort((a, b) => b.score - a.score).map(r => r.skill)
  }

  /**
   * Target-aware skill matching has been removed (Phase 7.2 — pure discovery).
   * The brain and council now select skills themselves via the `search` method
   * (exact/controlled token matching only) and the listSkills / searchSkills
   * brain tools. No substring scoring of free-form user/LLM text remains.
   */
  list(): SkillMeta[] {
    return Array.from(this.skills.values())
  }

  count(): number {
    return this.skills.size
  }
}

export * from './loader'
