/**
 * @deprecated Use the graph schema types (`src/graph/schema.ts`) and council
 * types (`src/council/types.ts`) instead. This module is retained solely for
 * backward compatibility with legacy v6/v7 context reader/writer workflows.
 */
import { z } from 'zod'
import { NodeType, EdgeType } from '../graph/schema'

// HAR-related schemas
export const HarEntrySchema = z.object({
  startedDateTime: z.string(),
  request: z.object({
    method: z.string(),
    url: z.string(),
    headers: z.array(z.object({
      name: z.string(),
      value: z.string()
    })),
    postData: z.object({
      mimeType: z.string(),
      text: z.string()
    }).optional()
  }),
  response: z.object({
    status: z.number(),
    statusText: z.string(),
    headers: z.array(z.object({
      name: z.string(),
      value: z.string()
    })),
    content: z.object({
      mimeType: z.string(),
      text: z.string(),
      size: z.number()
    })
  })
})

export const HarLogSchema = z.object({
  version: z.string(),
  creator: z.object({
    name: z.string(),
    version: z.string()
  }),
  entries: z.array(HarEntrySchema)
})

// Endpoint schema
export const EndpointSchema = z.object({
  url: z.string(),
  method: z.string(),
  params: z.record(z.string(), z.string()),
  headers: z.record(z.string(), z.string())
})

// Form field schema
export const FormFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean()
})

// Form schema
export const FormSchema = z.object({
  url: z.string(),
  method: z.string(),
  fields: z.array(FormFieldSchema)
})

// AppModel schema
export const AppModelSchema = z.object({
  target: z.string(),
  techStack: z.array(z.string()),
  authDetected: z.boolean(),
  authType: z.string().optional(),
  endpoints: z.array(EndpointSchema),
  forms: z.array(FormSchema),
  har: z.object({
    log: HarLogSchema
  })
})

// Finding schema
export const FindingSchema = z.object({
  id: z.string(),
  type: z.literal('FINDING'),
  label: z.string(),
  properties: z.object({
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    technique: z.string(),
    endpoint: z.string(),
    evidence: z.array(z.string()),
    remediation: z.string().optional(),
    cwe: z.string().optional(),
    confidence: z.number().min(0).max(1)
  }),
  createdAt: z.string(),
  updatedAt: z.string()
})

// Trace schema
export const TraceSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.enum(['attack', 'discovery', 'error']),
  technique: z.string(),
  endpoint: z.string(),
  request: z.object({
    method: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.string().optional()
  }),
  response: z.object({
    status: z.number(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
    duration: z.number()
  }),
  result: z.enum(['success', 'failure', 'partial']),
  finding: z.any().optional() // Can be a FindingNode or null
})

// Scan info schema
export const ScanInfoSchema = z.object({
  id: z.string(),
  target: z.string().optional(),
  createdAt: z.string(),
  status: z.enum(['created', 'running', 'completed', 'failed']),
  cycles: z.number().default(0),
  totalFindings: z.number().default(0),
  chainsDetected: z.number().default(0),
  updatedAt: z.string().optional()
})

// Hypothesis schema
export const HypothesisSchema = z.object({
  id: z.string(),
  technique: z.string(),
  endpoint: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  priority: z.number().min(1).max(10),
  createdAt: z.string(),
  tested: z.boolean().default(false),
  result: z.enum(['pending', 'success', 'failure', 'partial']).optional(),
  evidence: z.array(z.string()).default([])
})

// Chain schema
export const ChainSchema = z.object({
  id: z.string(),
  techniques: z.array(z.string()),
  description: z.string(),
  impact: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  nextSteps: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string()
})

// Node data schemas
export const GraphNodeDataSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(NodeType),
  label: z.string(),
  properties: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const GraphEdgeDataSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  type: z.nativeEnum(EdgeType),
  properties: z.record(z.string(), z.unknown()),
  createdAt: z.number()
})

// Graph store schema
export const GraphStoreSchema = z.object({
  nodes: z.array(GraphNodeDataSchema),
  edges: z.array(GraphEdgeDataSchema)
})

// Context data schemas
export const ContextDataSchema = z.object({
  appModel: AppModelSchema.nullable(),
  findings: z.array(FindingSchema),
  traces: z.array(TraceSchema)
})

// Scan configuration schema
export const ScanConfigSchema = z.object({
  target: z.string(),
  maxCycles: z.number().min(1).default(10),
  maxTotalTime: z.number().min(60).default(3600), // seconds
  maxEndpoints: z.number().min(10).default(1000),
  confidenceThreshold: z.number().min(0).max(1).default(0.8),
  techniques: z.array(z.string()).optional(),
  headless: z.boolean().default(true),
  proxy: z.string().optional(),
  timeout: z.number().min(10).default(30)
})

// Error response schema
export const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  details: z.record(z.string(), z.unknown()).optional()
})

// Success response schema
export const SuccessResponseSchema = z.object({
  ok: z.literal(true),
  value: z.unknown()
})

// API response schemas
export const ApiResponseSchema = z.discriminatedUnion('ok', [
  ErrorResponseSchema,
  SuccessResponseSchema
])

// Progress tracking schema
export const ProgressTrackerSchema = z.object({
  currentCycle: z.number(),
  totalCycles: z.number(),
  progress: z.number().min(0).max(1),
  timeElapsed: z.number(),
  timeRemaining: z.number().optional(),
  findings: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    info: z.number()
  }),
  workers: z.object({
    active: z.number(),
    completed: z.number(),
    failed: z.number()
  }),
  chains: z.number()
})

// Export types
export type AppModel = z.infer<typeof AppModelSchema>
export type Finding = z.infer<typeof FindingSchema>
export type Trace = z.infer<typeof TraceSchema>
export type ScanInfo = z.infer<typeof ScanInfoSchema>
export type Hypothesis = z.infer<typeof HypothesisSchema>
export type Chain = z.infer<typeof ChainSchema>
export type GraphNodeData = z.infer<typeof GraphNodeDataSchema>
export type GraphEdgeData = z.infer<typeof GraphEdgeDataSchema>
export type GraphStore = z.infer<typeof GraphStoreSchema>
export type ContextData = z.infer<typeof ContextDataSchema>
export type ScanConfig = z.infer<typeof ScanConfigSchema>
export type ApiResponse = z.infer<typeof ApiResponseSchema>
export type ProgressTracker = z.infer<typeof ProgressTrackerSchema>

// Validation functions
export function validateAppModel(data: unknown): AppModel {
  return AppModelSchema.parse(data)
}

export function validateFinding(data: unknown): Finding {
  return FindingSchema.parse(data)
}

export function validateTrace(data: unknown): Trace {
  return TraceSchema.parse(data)
}

export function validateScanInfo(data: unknown): ScanInfo {
  return ScanInfoSchema.parse(data)
}

export function validateHypothesis(data: unknown): Hypothesis {
  return HypothesisSchema.parse(data)
}

export function validateChain(data: unknown): Chain {
  return ChainSchema.parse(data)
}

export function validateGraphStore(data: unknown): GraphStore {
  return GraphStoreSchema.parse(data)
}

export function validateContextData(data: unknown): ContextData {
  return ContextDataSchema.parse(data)
}

export function validateScanConfig(data: unknown): ScanConfig {
  return ScanConfigSchema.parse(data)
}

export function validateApiResponse(data: unknown): ApiResponse {
  return ApiResponseSchema.parse(data)
}

export function validateProgressTracker(data: unknown): ProgressTracker {
  return ProgressTrackerSchema.parse(data)
}