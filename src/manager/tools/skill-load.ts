import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'
import { loadSkill } from '../../solver/skills/loader'

export function createSkillLoadTool(skillRegistry: SkillRegistry) {
  return createTool({
    id: 'skill-load',
    description: 'Load a specific skill by ID to get its full definition and instructions',
    inputSchema: z.object({
      skillId: z.string().describe('ID of the skill to load'),
    }),
    outputSchema: z.object({
      skill: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        category: z.string(),
        tier: z.string(),
        instructions: z.string(),
      }).nullable(),
    }),
    execute: async ({ skillId }) => {
      const meta = skillRegistry.get(skillId)
      if (!meta) {
        return { ok: true, value: { skill: null } }
      }

      // Load full body on demand (progressive disclosure)
      const fullSkill = loadSkill(skillId)

      return {
        ok: true,
        value: {
          skill: {
            id: meta.id,
            name: meta.name,
            description: meta.description,
            category: meta.category,
            tier: meta.tier,
            instructions: fullSkill?.instructions ?? '',
          },
        },
      }
    },
  })
}
