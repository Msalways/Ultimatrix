import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getToolRegistry } from '../../tools/resolver'

export function createExecuteDirectTool() {
  return createTool({
    id: 'execute_direct',
    description: 'Execute a tool directly without spawning a worker. Use for simple, quick checks that don\'t need specialist expertise.',
    inputSchema: z.object({
      tool: z.string().describe('Tool name to execute'),
      args: z.any().describe('Tool arguments'),
    }),
    execute: async ({ tool, args }) => {
      try {
        const registry = getToolRegistry()
        const t = registry.get(tool)
        if (!t) {
          return {
            ok: false,
            error: `Tool not found: ${tool}`,
          }
        }
        const result = await t.execute(args)
        return {
          ok: true,
          value: result,
        }
      } catch (e) {
        return {
          ok: false,
          error: `Direct execution failed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  })
}
