import { getAllSkills, loadSkill, initSkillIndex, type Skill, type SkillMeta, type SkillTier } from './loader'

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

      // contextBoosts match (replaces hardcoded AUTH_SKILLS, SQL_SKILLS, etc.)
      if (context?.graphSummary && skill.contextBoosts.length > 0) {
        const gs = context.graphSummary
        for (const boost of skill.contextBoosts) {
          if (boost === 'auth' && gs.hasAuth) { score += 8; reasons.push('boost: auth') }
          if (boost === 'sqli' && gs.hasSQL) { score += 5; reasons.push('boost: sqli') }
          if (boost === 'graphql' && gs.hasGraphQL) { score += 5; reasons.push('boost: graphql') }
          if (boost === 'endpoints' && gs.untestedEndpoints > 3) { score += 3; reasons.push('boost: endpoints') }
          if (boost === 'api' && (gs.hasGraphQL || gs.hasFileUpload)) { score += 4; reasons.push('boost: api') }
          if (boost === 'websocket' && gs.hasFileUpload) { score += 3; reasons.push('boost: websocket') }
        }
      }

      // Composition rules: boost if this skill enhances a previously-used skill
      if (context?.previousSkills && skill.compositionRules) {
        for (const prevSkill of context.previousSkills) {
          if (skill.compositionRules.requires?.includes(prevSkill)) {
            score += 6; reasons.push(`composition: requires ${prevSkill}`)
          }
          if (skill.compositionRules.enhances?.includes(prevSkill)) {
            score += 4; reasons.push(`composition: enhances ${prevSkill}`)
          }
        }
      }

      // Composition rules: penalize conflicting skills
      if (context?.previousSkills && skill.compositionRules?.conflicts?.length) {
        const conflicts = context.previousSkills.filter(s => skill.compositionRules!.conflicts!.includes(s))
        if (conflicts.length > 0) {
          score -= 5 * conflicts.length; reasons.push(`composition: conflicts with ${conflicts.join(',')}`)
        }
      }

      // Goal alignment boost
      if (context?.goal) {
        const goalLower = context.goal.toLowerCase()
        if (goalLower.includes('xss') || goalLower.includes('cross-site')) {
          if (skill.contextBoosts.includes('web-attacks') || skill.domain === 'web-attacks') {
            score += 7; reasons.push('goal: XSS alignment')
          }
        }
        if (goalLower.includes('sqli') || goalLower.includes('sql injection')) {
          if (skill.contextBoosts.includes('sqli') || skill.domain === 'injection') {
            score += 7; reasons.push('goal: SQLi alignment')
          }
        }
        if (goalLower.includes('idor') || goalLower.includes('access control')) {
          if (skill.contextBoosts.includes('auth') || skill.domain === 'auth-security') {
            score += 7; reasons.push('goal: IDOR alignment')
          }
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

  list(): SkillMeta[] {
    return Array.from(this.skills.values())
  }

  count(): number {
    return this.skills.size
  }
}

export * from './loader'
