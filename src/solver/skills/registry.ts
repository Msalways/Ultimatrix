import { initSkillIndex, loadSkillBody, searchSkillMetadata, type Skill, type SkillMeta } from './loader'

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

  /** Load one exact catalog entry. Unknown or unreadable skills fail closed. */
  load(skillId: string): Skill {
    this.get(skillId)
    const skill = loadSkillBody(skillId)
    if (!skill) throw new Error(`Skill body not found: ${skillId}`)
    return skill
  }

  search(query: string): SkillMeta[] {
    return searchSkillMetadata(this.skills.values(), query)
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
