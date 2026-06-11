import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { Stagehand } from '@browserbasehq/stagehand'

let _stagehand: Stagehand | null = null

export function setGlobalStagehand(s: Stagehand): void {
  _stagehand = s
}

export function getGlobalStagehand(): Stagehand | null {
  return _stagehand
}

export const stagehandAct = createTool({
  id: 'stagehandAct',
  description: 'Execute a natural language action via Stagehand (click, fill, navigate, etc.). Example: "click the login button" or "fill the email field with test@example.com".',
  inputSchema: z.object({
    instruction: z.string().describe('Natural language instruction for the action'),
    timeout: z.number().optional().default(15000),
  }),
  execute: async ({ instruction, timeout }) => {
    try {
      const sh = getGlobalStagehand()
      if (!sh) return { ok: false, error: 'Stagehand not initialized' }
      const result = await (sh as any).act(instruction, { timeout })
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const stagehandExtract = createTool({
  id: 'stagehandExtract',
  description: 'Extract structured data from the page using Stagehand. Provide a natural language description of what to extract and an optional JSON schema.',
  inputSchema: z.object({
    instruction: z.string().describe('Natural language description of data to extract'),
    schema: z.any().optional().describe('Optional JSON schema for structured extraction'),
    timeout: z.number().optional().default(15000),
  }),
  execute: async ({ instruction, schema, timeout }) => {
    try {
      const sh = getGlobalStagehand()
      if (!sh) return { ok: false, error: 'Stagehand not initialized' }
      const result = await (sh as any).extract(instruction, { schema, timeout })
      return { ok: true, data: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const stagehandAgent = createTool({
  id: 'stagehandAgent',
  description: 'Execute a multi-step goal via Stagehand\'s built-in agent. Provide a high-level objective like "fill out the registration form and submit it".',
  inputSchema: z.object({
    goal: z.string().describe('Multi-step objective for the Stagehand agent'),
    timeout: z.number().optional().default(30000),
  }),
  execute: async ({ goal, timeout }) => {
    try {
      const sh = getGlobalStagehand()
      if (!sh) return { ok: false, error: 'Stagehand not initialized' }
      const agent = (sh as any).agent()
      const result = await agent.execute(goal, { timeout })
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})