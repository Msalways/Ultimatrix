import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SkillRegistry } from '../../solver/skills/registry'
import { loadSkill } from '../../solver/skills/loader'
import type { UltimatrixConfig } from '../../config'

export function createExecuteDirectTool(config: UltimatrixConfig, skillRegistry: SkillRegistry) {
  return createTool({
    id: 'execute-direct',
    description: 'Execute a simple task directly without spawning a worker. Use for quick checks: HTTP requests, status checks, header inspection, simple reconnaissance.',
    inputSchema: z.object({
      task: z.string().describe('Natural language task to execute directly (e.g. "check HTTP headers on /api/health")'),
      skillId: z.string().optional().describe('Optional skill ID to load instructions from'),
    }),
    outputSchema: z.object({
      result: z.string(),
      error: z.string().optional(),
    }),
    execute: async ({ task, skillId }, _context) => {

      try {
        let skillContext = ''
        if (skillId) {
          const fullSkill = loadSkill(skillId)
          if (fullSkill) {
            skillContext = `\n\n## Skill Reference: ${fullSkill.name}\n${fullSkill.instructions}`
          }
        }

        // SUPERVISOR-3: Actually execute the task via HTTP tools
        const { httpRequest } = await import('../../tools/http-tools')
        const { getGlobalGraphStore } = await import('../../graph/store')
        const store = getGlobalGraphStore()
        const endpoints = store?.queryNodes(undefined, { type: 'Endpoint' } as any) || []

        // Parse task for URL patterns and execute directly
        const urlMatch = task.match(/(https?:\/\/[^\s]+)/i)
        if (urlMatch) {
          const url = urlMatch[1]
          const response = await (httpRequest as any).execute({
            method: 'GET',
            url,
            timeoutMs: 10000,
          }) as any

          if (response.ok) {
            const { status, headers, body } = response.value as any
            const headerStr = Object.entries(headers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('\n')
            return {
              result: `[execute-direct] ${task}\n\nStatus: ${status}\nHeaders:\n${headerStr}\n\nBody (first 2000 chars):\n${(body as string).substring(0, 2000)}${skillContext}`,
              error: undefined,
            }
          } else {
            return {
              result: `[execute-direct] ${task}\n\nRequest failed with status: ${(response.value as any)?.status || 'unknown'}${skillContext}`,
              error: undefined,
            }
          }
        }

        return {
          result: `[execute-direct] Task accepted: ${task}${skillContext ? '\n(Skill context loaded)' : ''}. No URL found in task — use httpRequest tool for direct requests.`,
          error: undefined,
        }
      } catch (error) {
        return {
          result: '',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
}