import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'

export function createSkillSearchTool(skillRegistry: SkillRegistry) {
  return createTool({
    id: 'searchSkills',
    description: 'Search for available skills by name, tag, or capability',
    inputSchema: z.object({
      query: z.string().describe('Search query (name, tag, or capability description)'),
      tag: z.string().optional().describe('Filter by skill tag'),
    }),
    outputSchema: z.object({
      skills: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        toolRefs: z.array(z.string()),
      })),
    }),
    execute: async ({ query, tag }) => {

      if (tag) {
        const q = tag.toLowerCase()
        const filtered = skillRegistry.list().filter(s =>
          s.toolRefs.some(t => t.toLowerCase().includes(q))
        )
        return {
          skills: filtered.map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            toolRefs: s.toolRefs,
          })),
        }
      }

      if (query) {
        const results = skillRegistry.search(query)
        return {
          skills: results.map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            toolRefs: s.toolRefs,
          })),
        }
      }

      return {
        skills: skillRegistry.list().map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          toolRefs: s.toolRefs,
        })),
      }
    },
  })
}
