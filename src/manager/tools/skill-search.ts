import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'

export function createSkillSearchTool(skillRegistry: SkillRegistry) {
  return createTool({
    id: 'skill-search',
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
        tags: z.array(z.string()),
      })),
    }),
    execute: async ({ query, tag }) => {

      if (tag) {
        const q = tag.toLowerCase()
        const filtered = skillRegistry.list().filter(s =>
          s.tags.some(t => t.toLowerCase().includes(q))
        )
        return {
          skills: filtered.map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            tags: s.tags,
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
            tags: s.tags,
          })),
        }
      }

      return {
        skills: skillRegistry.list().map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          tags: s.tags,
        })),
      }
    },
  })
}