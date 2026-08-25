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

/**
 * F2 (Base Architecture Contracts) â€” the registry is a READ-THROUGH view over
 * the shared loader index (the single live authority). `this.skills` is a
 * warm-up snapshot only: every authorization/load/search call resolves LIVE,
 * so a mid-session manageSkills import is immediately spawnable by workers.
 * Snapshots authorize nothing.
 */
export class SkillRegistry {
  private skills: Map<string, SkillMeta> = new Map()
  private recentSkillCounts: Map<string, number> = new Map()

  loadFromDirectory(_dir: string): void {
    // Warm-up copy (kept for backward-compatible direct `.skills` reads).
    const allSkills = initSkillIndex()
    for (const [id, meta] of allSkills) {
      this.skills.set(id, meta)
    }
  }

  /**
   * Live lookup â€” the shared index is the authority whenever it is populated
   * (production). An absent/empty index (unit-test mocks, no-skill installs)
   * falls back to the warm-up snapshot so seeded registries keep working.
   */
  private liveSource(): Map<string, SkillMeta> {
    const live = initSkillIndex()
    return live && live.size > 0 ? live : this.skills
  }

  private live(skillId: string): SkillMeta | undefined {
    return this.liveSource().get(skillId)
  }

  get(skillId: string): SkillMeta {
    const skill = this.live(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)
    return skill
  }

  has(skillId: string): boolean {
    return this.live(skillId) !== undefined
  }

  /** Load one exact catalog entry. Unknown or unreadable skills fail closed. */
  load(skillId: string): Skill {
    this.get(skillId)
    const skill = loadSkillBody(skillId)
    if (!skill) throw new Error(`Skill body not found: ${skillId}`)
    return skill
  }

  search(query: string): SkillMeta[] {
    return searchSkillMetadata(this.liveSource().values(), query)
  }

  /**
   * Target-aware skill matching has been removed (Phase 7.2 â€” pure discovery).
   * The brain and council now select skills themselves via the `search` method
   * (exact/controlled token matching only) and the listSkills / searchSkills
   * brain tools. No substring scoring of free-form user/LLM text remains.
   */
  list(): SkillMeta[] {
    return Array.from(this.liveSource().values())
  }

  count(): number {
    return this.liveSource().size
  }
}

export * from './loader'
