import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'

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
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
      }).nullable(),
    }),
    execute: async ({ skillId }) => {
      const skill = skillRegistry.get(skillId)
      
      if (!skill) {
        return { ok: true, value: { skill: null } }
      }
      
      return {
        ok: true,
        value: {
          skill: {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            category: skill.category,
            tier: skill.tier,
            instructions: skill.instructions,
            inputSchema: skill.inputSchema,
            outputSchema: skill.outputSchema,
          },
        },
      }
    },
  })
}