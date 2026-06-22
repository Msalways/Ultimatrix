import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'

export function createSkillSearchTool(skillRegistry: SkillRegistry) {
  return createTool({
    id: 'skill-search',
    description: 'Search for available skills by name, category, or capability',
    inputSchema: z.object({
      query: z.string().describe('Search query (name, category, or capability)'),
      category: z.string().optional().describe('Filter by skill category'),
    }),
    outputSchema: z.object({
      skills: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        category: z.string(),
        tier: z.string(),
      })),
    }),
    execute: async ({ context }) => {
      const { query, category } = context
      let skills = skillRegistry.list()
      
      if (category) {
        skills = skills.filter(s => s.category === category)
      }
      
      if (query) {
        const q = query.toLowerCase()
        skills = skills.filter(s => 
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
        )
      }
      
      return {
        skills: skills.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          category: s.category,
          tier: s.tier,
        })),
      }
    },
  })
}