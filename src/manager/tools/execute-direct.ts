import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export function createExecuteDirectTool() {
  return createTool({
    id: 'execute-direct',
    description: 'Execute a skill directly without spawning a worker (for simple tasks)',
    inputSchema: z.object({
      skillId: z.string().describe('ID of the skill to execute'),
      input: z.unknown().describe('Input data for the skill'),
    }),
    outputSchema: z.object({
      result: z.unknown(),
      error: z.string().optional(),
    }),
    execute: async ({ context }) => {
      const { skillId, input } = context
      
      try {
        // This would typically call the skill's execute method directly
        // For now, return a placeholder
        return { result: { executed: true, skillId, input } }
      } catch (error) {
        return { 
          result: null, 
          error: error instanceof Error ? error.message : String(error) 
        }
      }
    },
  })
}