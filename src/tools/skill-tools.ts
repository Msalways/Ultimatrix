import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { loadSkill, listReferences, loadReference, getAllSkills, type SkillMeta } from '../solver/skills/loader'
import { getSkillKnowledgeStore, type SkillKnowledgeRecord } from '../intelligence/skill-knowledge'

export const listSkills = createTool({
  id: 'listSkills',
  description: 'List all available skills. Optional filters: by domain, category, or tier. Returns compact catalog with id, name, domain, description, tier, and composition rules.',
  inputSchema: z.object({
    domain: z.string().optional().describe('Filter by domain (e.g. "injection", "web-attacks", "auth-security")'),
    category: z.string().optional().describe('Filter by category (alias for domain)'),
    tier: z.enum(['fast', 'balanced', 'powerful']).optional().describe('Filter by tier'),
  }),
  execute: async ({ domain, category, tier }) => {
    let skills = getAllSkills()
    const filter = domain || category
    if (filter) {
      const f = filter.toLowerCase()
      skills = skills.filter(s => s.domain.toLowerCase() === f || s.category.toLowerCase() === f)
    }
    if (tier) {
      skills = skills.filter(s => s.tier === tier)
    }

    // Group by domain for compact display
    const grouped: Record<string, Array<{ id: string; name: string; description: string; tier: string; mitreAttack: string[]; owaspRefs: string[] }>> = {}
    for (const s of skills) {
      const d = s.domain || 'uncategorized'
      if (!grouped[d]) grouped[d] = []
      grouped[d].push({
        id: s.id,
        name: s.name,
        description: s.description.slice(0, 120),
        tier: s.tier,
        mitreAttack: s.mitreAttack,
        owaspRefs: s.owaspRefs,
      })
    }

    return {
      ok: true,
      value: {
        total: skills.length,
        domains: Object.keys(grouped).length,
        skills: grouped,
      },
    }
  },
})

export const loadSkillReference = createTool({
  id: 'loadSkillReference',
  description: 'Load a specific reference document from a skill for detailed methodology guidance.',
  inputSchema: z.object({
    skillId: z.string().describe('Skill ID (e.g. "pentest-flow", "web-pentest")'),
    referenceId: z.string().optional().describe('Reference document ID. If omitted, lists available references.'),
  }),
  execute: async ({ skillId, referenceId }) => {
    if (!referenceId) {
      const refs = listReferences(skillId)
      if (refs.length === 0) {
        return { ok: true, value: { message: `No references found for skill "${skillId}"`, references: [] } }
      }
      return {
        ok: true,
        value: {
          message: `Found ${refs.length} reference(s) for "${skillId}"`,
          references: refs.map(r => ({ id: r.id, title: r.title })),
        },
      }
    }

    const content = loadReference(skillId, referenceId)
    if (!content) {
      return { ok: false, error: `Reference "${referenceId}" not found in skill "${skillId}"` }
    }
    return { ok: true, value: { skillId, referenceId, content } }
  },
})

export const searchSkillTool = createTool({
  id: 'searchSkills',
  description: 'Search skills by keyword when you know what attack type you need (e.g. "SQL injection", "race condition"). For a complete catalog, browse all available skills instead of searching.',
  inputSchema: z.object({
    query: z.string().describe('Search query (e.g. "SQL injection", "race condition")'),
  }),
  execute: async ({ query }) => {
    const { searchSkills } = await import('../solver/skills/loader')
    const results = searchSkills(query)
    return {
      ok: true,
      value: {
        count: results.length,
        skills: results.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          description: s.description,
        })),
      },
    }
  },
})

export const loadSkillBodyTool = createTool({
  id: 'loadSkillBody',
  description: 'Load a skill\'s full methodology instructions, tool chains, composition rules, and references. Returns the complete attack guidance for a specific skill. Use this after searchSkills identifies a relevant skill — load its body to get the detailed attack methodology before delegating to a worker or applying it directly.',
  inputSchema: z.object({
    skillId: z.string().describe('Skill ID (e.g. "injection/exploitation", "web-attacks/web-pentest", "auth-security/authorization")'),
  }),
  execute: async ({ skillId }) => {
    const skill = loadSkill(skillId)
    if (!skill) return { ok: false, error: `Skill "${skillId}" not found. Use listSkills or searchSkills to find valid skill IDs.` }
    return {
      ok: true,
      value: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tier: skill.tier,
        instructions: skill.instructions,
        toolRefs: skill.toolRefs,
        toolChains: skill.toolChains,
        compositionRules: skill.compositionRules,
        references: skill.references.map(r => ({ id: r.id, title: r.title })),
      },
    }
  },
})

/**
 * Detect target type from URL and return the most relevant skills.
 * This is a discovery accelerator — not a rigid methodology.
 * The brain decides which skills to actually load.
 */
function detectTargetType(url: string): string[] {
  const tags: string[] = []
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()

    // Web application patterns
    if (path.includes('/api') || path.includes('/graphql') || path.includes('/rest')) tags.push('api')
    if (host.includes('cloud') || host.includes('aws') || host.includes('azure') || host.includes('gcp')) tags.push('cloud')
    if (host.includes('login') || path.includes('/auth') || path.includes('/sso') || path.includes('/oauth')) tags.push('auth')
    if (path.includes('/admin') || path.includes('/dashboard') || path.includes('/manage')) tags.push('admin')
    if (host.includes('jenkins') || host.includes('gitlab') || host.includes('github') || host.includes('jira')) tags.push('devops')

    // Default: web application
    if (tags.length === 0) tags.push('web')
  } catch {
    tags.push('web')
  }
  return tags
}

/** Score a skill's relevance to detected target types. */
function scoreRelevance(skill: SkillMeta, targetTypes: string[]): number {
  let score = 0
  const domain = skill.domain.toLowerCase()
  const id = skill.id.toLowerCase()

  // Methodology skills are cross-domain routing assets: they should be
  // discoverable for a web/API target even when their folder is a newer
  // knowledge-base namespace (for example bug-bounty/). Context boosts then
  // provide the target-specific ranking instead of a hardcoded domain list.
  if (skill.category.toLowerCase() === 'methodology') score += 2
  for (const boost of skill.contextBoosts ?? []) {
    if (targetTypes.includes(boost.toLowerCase())) score += 2
  }

  // Direct domain matches
  if (targetTypes.includes('api') && (domain.includes('api') || domain.includes('graphql'))) score += 3
  if (targetTypes.includes('cloud') && domain.includes('cloud')) score += 3
  if (targetTypes.includes('auth') && domain.includes('auth')) score += 3
  if (targetTypes.includes('devops') && (domain.includes('supply') || domain.includes('recon'))) score += 2

  // Web is the default — broad web-attack skills get moderate score
  if (targetTypes.includes('web')) {
    if (domain.includes('injection') || domain.includes('web-attack')) score += 2
    if (domain.includes('auth')) score += 2
    if (domain.includes('recon')) score += 1
  }

  // High-value universal skills
  if (id.includes('web-pentest') || id.includes('exploitation') || id.includes('vuln-discovery')) score += 2
  if (id.includes('authorization') || id.includes('jwt')) score += 1

  return score
}

/**
 * Turn confirmed cross-engagement outcomes into a small ranking signal. The
 * signal is intentionally bounded: learned history can break ties and move a
 * skill up, but it can never override target evidence or the skill contract.
 */
function scoreLearnedRelevance(skill: SkillMeta, records: SkillKnowledgeRecord[]): number {
  const skillTokens = new Set([
    skill.id.toLowerCase(),
    skill.name.toLowerCase(),
    ...(skill.triggers ?? []).map(trigger => trigger.toLowerCase()),
  ])
  let confirmed = 0
  let failed = 0
  for (const record of records) {
    const technique = record.techniqueId.toLowerCase()
    const direct = record.skillId?.toLowerCase() === skill.id.toLowerCase()
    const related = direct || [...skillTokens].some(token => token.length > 2 && (technique.includes(token) || token.includes(technique)))
    if (!related) continue
    confirmed += record.confirmed
    failed += record.failed
  }
  // A single successful observation is not enough to dominate discovery; the
  // score caps at +3 and repeated failures can only remove that learned boost.
  return Math.max(-1, Math.min(3, confirmed - failed > 0 ? Math.floor((confirmed - failed) / 2) + 1 : 0))
}

export const discoverSkillsForTarget = createTool({
  id: 'discoverSkillsForTarget',
  description: 'Analyze a target URL and return the top relevant skill domains + IDs for attacking it. Use this to quickly discover which skills to load instead of browsing the full live skill registry. Returns ranked suggestions — call loadSkillBody on the ones you want to use.',
  inputSchema: z.object({
    url: z.string().describe('Target URL to analyze (e.g. "http://localhost:3000/api")'),
  }),
  execute: async ({ url }) => {
    const allSkills = getAllSkills()
    const targetTypes = detectTargetType(url)
    let learnedRecords: SkillKnowledgeRecord[] = []
    try {
      learnedRecords = await getSkillKnowledgeStore().list()
    } catch {
      // Discovery remains useful when the optional global learning file is
      // unavailable or has not been created yet.
    }

    // Score and rank skills
    const scored = allSkills
      .map(skill => ({
        skill,
        score: scoreRelevance(skill, targetTypes) + scoreLearnedRelevance(skill, learnedRecords),
      }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)

    // Return top 10 most relevant
    const top = scored.slice(0, 10)
    return {
      ok: true,
      value: {
        targetTypes,
        totalSkills: allSkills.length,
        suggestions: top.map(({ skill, score }) => ({
          id: skill.id,
          name: skill.name,
          domain: skill.domain,
          description: skill.description.slice(0, 100),
          relevance: score,
          learnedBoost: scoreLearnedRelevance(skill, learnedRecords),
          primitives: skill.primitives.slice(0, 3),
        })),
        hint: `Load the most relevant skill with: loadSkillBody(skillId="${top[0]?.skill.id ?? 'web-pentest'}")`,
      },
    }
  },
})
