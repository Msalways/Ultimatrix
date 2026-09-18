/**
 * Telemetry types (Phase 0 — Baseline Instrumentation).
 *
 * Per-task telemetry for measuring runtime improvements. Every metric
 * needed to compare "OLD WORKER vs COMPILED WORKER" using deterministic
 * measurements.
 */

/** Identity for a telemetry record */
export interface TelemetryIdentity {
  runId: string
  taskId: string
  skillId?: string
  model: string
  provider: string
}

/** Context metrics — what the model could see */
export interface TelemetryContext {
  visibleTools: string[]
  visiblePrimitives: string[]
  toolSchemaTokens: number
  skillTokens: number
  retrievedContextTokens: number
}

/** Reasoning metrics — what the model did */
export interface TelemetryReasoning {
  modelCalls: number
  toolCalls: number
  invalidToolCalls: number
  irrelevantToolCalls: number
  retries: number
  firstActionMs?: number
}

/** Evidence metrics — what was produced */
export interface TelemetryEvidence {
  evidenceCreated: number
  artifactsCreated: number
  candidateFindings: number
  acceptedFindings: number
  rejectedFindings: number
}

/** Complete per-task telemetry record */
export interface TaskTelemetry {
  identity: TelemetryIdentity
  context: TelemetryContext
  reasoning: TelemetryReasoning
  evidence: TelemetryEvidence
  durationMs: number
  startedAt: number
  endedAt: number
}

/** Aggregated telemetry for an entire run */
export interface RunTelemetry {
  runId: string
  taskCount: number
  totalDurationMs: number
  tasks: TaskTelemetry[]

  /** Aggregate context metrics */
  avgToolsPerTask: number
  avgContextTokens: number
  totalModelCalls: number
  totalToolCalls: number

  /** Aggregate evidence metrics */
  totalEvidenceCreated: number
  totalCandidateFindings: number
  totalAcceptedFindings: number
  acceptanceRate: number

  /** Aggregate reasoning metrics */
  totalInvalidToolCalls: number
  totalIrrelevantToolCalls: number
  avgRetriesPerTask: number
}

/** Diff between baseline and improved telemetry */
export interface TelemetryDiff {
  contextReduction: number    // % reduction in context tokens
  toolReduction: number       // % reduction in visible tools
  invalidCallReduction: number // % reduction in invalid tool calls
  acceptanceRateChange: number // change in finding acceptance rate
  durationChange: number       // % change in total duration
}

/** Per-tool call event for granular tracking */
export interface ToolCallEvent {
  toolId: string
  timestamp: number
  durationMs: number
  success: boolean
  error?: string
}

/** Per-model call event */
export interface ModelCallEvent {
  timestamp: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  model: string
}
