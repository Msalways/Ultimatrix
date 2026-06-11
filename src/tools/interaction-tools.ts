import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { promptUser } from '../utils/readline'

export const askUser = createTool({
  id: 'askUser',
  description: 'Ask the user a question and wait for their response.',
  inputSchema: z.object({
    question: z.string(),
    options: z.array(z.string()).optional(),
  }),
  execute: async ({ question, options }) => {
    const answer = await promptUser(question, options)
    return { value: { answer }, ok: true }
  },
})
