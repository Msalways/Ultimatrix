import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'

export function createSkillLoadTool(skillRegistry: SkillRegistry) {
  return createTool({
    id: 'skill_load',
    description: "Load a skill's full instructions. Use this after skill_search to get the detailed guidance for a specific technique.",
    inputSchema: z.object({
      skillId: z.string().describe('ID of the skill to load, e.g., "sqli"'),
    }),
    execute: async ({ skillId }) => {
      try {
        const skill = skillRegistry.get(skillId)
        return {
          ok: true,
          value: {
            id: skill.id,
            name: skill.name,
            instructions: skill.instructions,
            toolRefs: skill.toolRefs,
            references: skill.references,
            tags: skill.tags,
            version: skill.version,
          }
        }
      } catch (e) {
        return {
          ok: false,
          error: `Skill load failed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  })
}
