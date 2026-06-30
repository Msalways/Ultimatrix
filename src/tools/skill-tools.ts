import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { loadSkill, listReferences, loadReference } from '../skills/loader'

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
  description: 'Search available skills by keyword to find relevant methodology guidance.',
  inputSchema: z.object({
    query: z.string().describe('Search query (e.g. "SQL injection", "race condition")'),
  }),
  execute: async ({ query }) => {
    const { searchSkills } = await import('../skills/loader')
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
          referenceCount: s.references.length,
        })),
      },
    }
  },
})
