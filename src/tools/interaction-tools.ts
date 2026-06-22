import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { EventEmitter } from 'events'

export const userInputEmitter = new EventEmitter()

export const askUser = createTool({
  id: 'askUser',
  description: 'Ask the user a question and wait for their response.',
  inputSchema: z.object({
    question: z.string(),
    options: z.array(z.string()).optional(),
  }),
  execute: async ({ question, options }) => {
    const optionsText = options?.length ? ` (${options.join(', ')})` : ''
    const fullQuestion = question + optionsText
    return new Promise<{ value: { answer: string; question: string }; ok: boolean }>((resolve) => {
      userInputEmitter.once('askUser-response', (answer: string) => {
        resolve({ value: { answer, question: fullQuestion }, ok: true })
      })
      userInputEmitter.emit('askUser-question', fullQuestion)
    })
  },
})
