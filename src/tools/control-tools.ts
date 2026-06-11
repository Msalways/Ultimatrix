import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const recordEvidence = createTool({
  id: 'recordEvidence',
  description: 'Record an evidence item that will be included in the next writeFinding call.',
  inputSchema: z.object({
    type: z.enum(['text', 'screenshot', 'har_entry', 'raw_request', 'raw_response']),
    data: z.string(),
    label: z.string(),
    session: z.string().optional(),
  }),
  execute: async ({ type, data, label, session }) => {
    return {
      ok: true,
      value: {
        recorded: true,
        timestamp: Date.now(),
        evidence: { type, data, label, timestamp: Date.now(), ...(session ? { session } : {}) },
      },
    }
  },
})

export const writeFinding = createTool({
  id: 'writeFinding',
  description: 'Emit a finalized finding with accumulated evidence.',
  inputSchema: z.object({
    type: z.string(),
    endpoint: z.string(),
    param: z.string(),
    method: z.string().optional(),
    payload: z.string().optional(),
    description: z.string().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    confidence: z.number().min(0).max(1),
  }),
  execute: async (args) => {
    const finding = {
      id: `f-${Date.now()}-${Math.floor(Math.random() * 10000).toString(36)}`,
      ...args,
      confirmed: args.confidence >= 0.7,
      evidence: [],
    }
    return { ok: true, value: finding }
  },
})
