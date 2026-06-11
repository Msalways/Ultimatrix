import { z } from 'zod'

export const TargetSchema = z.object({
  url: z.string().url(),
  status: z.enum(['idle', 'exploring', 'testing', 'reporting']).default('idle'),
  startedAt: z.number().default(() => Date.now()),
})

export const EndpointTestSchema = z.object({
  url: z.string(),
  technique: z.string(),
  param: z.string().optional(),
  result: z.enum(['vulnerable', 'not-vulnerable', 'in-progress', 'error']),
  confidence: z.number().min(0).max(1).optional(),
  testedAt: z.number().default(() => Date.now()),
})

export const FindingSchema = z.object({
  id: z.string(),
  type: z.string(),
  endpoint: z.string(),
  param: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  confidence: z.number().min(0).max(1),
  confirmed: z.boolean(),
  description: z.string().optional(),
  discoveredAt: z.number().default(() => Date.now()),
})

export const MemoryDedupKey = z.string()
// (type, endpoint, param) composite key for dedup

export function buildDedupKey(type: string, endpoint: string, param?: string): string {
  return `${type}::${endpoint}::${param || '*'}`
}

export const WorkingMemoryStateSchema = z.object({
  target: TargetSchema.optional(),
  endpointsTested: z.array(EndpointTestSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  dedupSet: z.array(z.string()).default([]),
  currentPhase: z.enum(['idle', 'observing', 'learning', 'attacking', 'reporting']).default('idle'),
})