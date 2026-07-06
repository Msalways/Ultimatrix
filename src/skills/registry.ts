import { getAllSkills, type Skill, type SkillTier } from './loader'

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
  skill: Skill
  matchScore: number
  matchReasons: string[]
}

const AUTH_SKILLS = new Set(['authorization', 'post-exploitation'])
const SQL_SKILLS = new Set(['vuln-discovery', 'exploitation'])
const WEBSOCKET_SKILLS = new Set(['web-pentest', 'web-security-advanced'])
const GRAPHQL_SKILLS = new Set(['web-pentest'])

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map()
  private recentSkillCounts: Map<string, number> = new Map()

  loadFromDirectory(_dir: string): void {
    const allSkills = getAllSkills()
    for (const skill of allSkills) {
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
      if (skill.instructions.toLowerCase().includes(q)) score += 2
      if (skill.toolRefs.some(t => t.toLowerCase().includes(q))) score += 3

      if (score > 0) results.push({ skill, score })
    }

    return results.sort((a, b) => b.score - a.score).map(r => r.skill)
  }

  /**
   * Target-aware skill matching. Scores skills based on:
   * - Keyword match (user input)
   * - Graph state (auth flows, SQL endpoints, etc.)
   * - Goal alignment (XSS → web-pentest)
   * - Skill diversity (penalize recently used)
   * - Complexity alignment (critical → powerful tier)
   */
  matchSkills(input: string, context?: SkillMatchContext): SkillMatch[] {
    const inputLower = input.toLowerCase()
    const results: SkillMatch[] = []

    for (const skill of this.skills.values()) {
      let score = 0
      const reasons: string[] = []

      // Keyword match (existing logic)
      if (skill.id.toLowerCase().includes(inputLower)) { score += 10; reasons.push('keyword: id') }
      if (skill.id.split('-').some(part => inputLower.includes(part))) { score += 6; reasons.push('keyword: parts') }
      if (skill.description.toLowerCase().split(' ').some(w => w.length > 3 && inputLower.includes(w))) {
        score += 3; reasons.push('keyword: description')
      }
      if (skill.name.toLowerCase().split(' ').some(w => w.length > 3 && inputLower.includes(w))) {
        score += 2; reasons.push('keyword: name')
      }

      // Graph state boost
      if (context?.graphSummary) {
        const gs = context.graphSummary
        if (gs.hasAuth && AUTH_SKILLS.has(skill.id)) {
          score += 8; reasons.push('graph: auth flows present')
        }
        if (gs.hasSQL && SQL_SKILLS.has(skill.id)) {
          score += 5; reasons.push('graph: SQL endpoints present')
        }
        if (gs.hasGraphQL && GRAPHQL_SKILLS.has(skill.id)) {
          score += 5; reasons.push('graph: GraphQL present')
        }
        if (gs.untestedEndpoints > 3 && skill.id === 'recon') {
          score += 3; reasons.push('graph: many untested endpoints')
        }
      }

      // Goal alignment boost
      if (context?.goal) {
        const goalLower = context.goal.toLowerCase()
        if ((goalLower.includes('xss') || goalLower.includes('cross-site')) && WEBSOCKET_SKILLS.has(skill.id)) {
          score += 7; reasons.push('goal: XSS alignment')
        }
        if ((goalLower.includes('sqli') || goalLower.includes('sql injection')) && SQL_SKILLS.has(skill.id)) {
          score += 7; reasons.push('goal: SQLi alignment')
        }
        if ((goalLower.includes('idor') || goalLower.includes('access control')) && AUTH_SKILLS.has(skill.id)) {
          score += 7; reasons.push('goal: IDOR alignment')
        }
      }

      // Skill diversity penalty
      if (context?.previousSkills?.includes(skill.id)) {
        const count = context.previousSkills.filter(s => s === skill.id).length
        const penalty = Math.min(count * 3, 9)
        score -= penalty
        if (penalty > 0) reasons.push(`diversity: used ${count}x (−${penalty})`)
      }

      // Complexity alignment
      if (context?.taskComplexity) {
        const tierForComplexity: Record<string, SkillTier> = {
          low: 'fast',
          medium: 'balanced',
          high: 'powerful',
          critical: 'powerful',
        }
        const expectedTier = tierForComplexity[context.taskComplexity]
        if (expectedTier && skill.tier === expectedTier) {
          score += 4; reasons.push(`complexity: ${skill.tier} matches ${context.taskComplexity}`)
        }
      }

      if (score > 0) {
        results.push({ skill, matchScore: score, matchReasons: reasons })
      }
    }

    return results.sort((a, b) => b.matchScore - a.matchScore)
  }

  recordSkillUse(skillId: string): void {
    const count = this.recentSkillCounts.get(skillId) ?? 0
    this.recentSkillCounts.set(skillId, count + 1)
  }

  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  count(): number {
    return this.skills.size
  }
}

export * from './loader'
