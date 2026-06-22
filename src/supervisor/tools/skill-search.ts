import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'

export function createSkillSearchTool(skillRegistry: SkillRegistry) {
  return createTool({
    id: 'skill_search',
    description: 'Search for relevant skills based on a query. Use this to find attack techniques, reconnaissance methods, or testing approaches for a given target.',
    inputSchema: z.object({
      query: z.string().describe('Search query, e.g., "sql injection", "graphql testing", "file upload bypass"'),
      limit: z.number().optional().default(5),
    }),
    execute: async ({ query, limit }) => {
      try {
        const results = skillRegistry.search(query).slice(0, limit)
        return {
          ok: true,
          value: {
            skills: results.map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
              tags: s.tags,
            }))
          }
        }
      } catch (e) {
        return {
          ok: false,
          error: `Skill search failed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  })
}
