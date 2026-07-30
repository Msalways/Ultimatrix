import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { loadSkill, listReferences, loadReference, getAllSkills } from '../solver/skills/loader'

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
