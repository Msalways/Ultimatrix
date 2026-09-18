/**
 * Telemetry Recorder (Phase 0 — Baseline Instrumentation).
 *
 * Records per-task telemetry for measuring runtime improvements.
 * Events are written to the forensic log as 'task-telemetry' entries.
 */

import type {
  TaskTelemetry,
  TelemetryIdentity,
  TelemetryContext,
  TelemetryReasoning,
  TelemetryEvidence,
  ToolCallEvent,
  ModelCallEvent,
} from './types'

/** Builder for constructing a TaskTelemetry record incrementally */
export class TelemetryBuilder {
  private identity: TelemetryIdentity
  private context: TelemetryContext = {
    visibleTools: [],
    visiblePrimitives: [],
    toolSchemaTokens: 0,
    skillTokens: 0,
    retrievedContextTokens: 0,
  }
  private reasoning: TelemetryReasoning = {
    modelCalls: 0,
    toolCalls: 0,
    invalidToolCalls: 0,
    irrelevantToolCalls: 0,
    retries: 0,
  }
  private evidence: TelemetryEvidence = {
    evidenceCreated: 0,
    artifactsCreated: 0,
    candidateFindings: 0,
    acceptedFindings: 0,
    rejectedFindings: 0,
  }
  private toolCalls: ToolCallEvent[] = []
  private modelCalls: ModelCallEvent[] = []
  private startedAt: number
  private firstActionAt?: number

  constructor(identity: TelemetryIdentity) {
    this.identity = identity
    this.startedAt = Date.now()
  }

  /** Set the visible tool and primitive sets for this task */
  setVisibleContext(tools: string[], primitives: string[]): this {
    this.context.visibleTools = tools
    this.context.visiblePrimitives = primitives
    return this
  }

  /** Set token estimates for context components */
  setTokenEstimates(opts: {
    toolSchemaTokens?: number
    skillTokens?: number
    retrievedContextTokens?: number
  }): this {
    if (opts.toolSchemaTokens !== undefined) this.context.toolSchemaTokens = opts.toolSchemaTokens
    if (opts.skillTokens !== undefined) this.context.skillTokens = opts.skillTokens
    if (opts.retrievedContextTokens !== undefined) this.context.retrievedContextTokens = opts.retrievedContextTokens
    return this
  }

  /** Record a tool call event */
  recordToolCall(event: ToolCallEvent): this {
    this.reasoning.toolCalls++
    if (!event.success) this.reasoning.invalidToolCalls++
    if (!this.firstActionAt) this.firstActionAt = event.timestamp
    this.toolCalls.push(event)
    return this
  }

  /** Record a model call event */
  recordModelCall(event: ModelCallEvent): this {
    this.reasoning.modelCalls++
    this.modelCalls.push(event)
    return this
  }

  /** Record a retry */
  recordRetry(): this {
    this.reasoning.retries++
    return this
  }

  /** Record evidence creation */
  recordEvidence(count = 1): this {
    this.evidence.evidenceCreated += count
    return this
  }

  /** Record artifact creation */
  recordArtifact(count = 1): this {
    this.evidence.artifactsCreated += count
    return this
  }

  /** Record a candidate finding */
  recordCandidateFinding(): this {
    this.evidence.candidateFindings++
    return this
  }

  /** Record a finding acceptance */
  recordFindingAccepted(): this {
    this.evidence.acceptedFindings++
    return this
  }

  /** Record a finding rejection */
  recordFindingRejected(): this {
    this.evidence.rejectedFindings++
    return this
  }

  /** Freeze the builder and return the complete telemetry record */
  build(): TaskTelemetry {
    const endedAt = Date.now()
    return {
      identity: { ...this.identity },
      context: { ...this.context },
      reasoning: {
        ...this.reasoning,
        ...(this.firstActionAt ? { firstActionMs: this.firstActionAt - this.startedAt } : {}),
      },
      evidence: { ...this.evidence },
      durationMs: endedAt - this.startedAt,
      startedAt: this.startedAt,
      endedAt,
    }
  }
}

/** Global telemetry recorder instance */
let globalRecorder: TelemetryRecorder | undefined

export function getGlobalTelemetryRecorder(): TelemetryRecorder {
  if (!globalRecorder) globalRecorder = new TelemetryRecorder()
  return globalRecorder
}

export function resetGlobalTelemetryRecorder(): void {
  globalRecorder = undefined
}

/**
 * TelemetryRecorder manages per-task telemetry builders.
 * Start a builder at task begin, record events during execution,
 * build at task end.
 */
export class TelemetryRecorder {
  private active = new Map<string, TelemetryBuilder>()
  private completed: TaskTelemetry[] = []

  /** Start recording telemetry for a task */
  start(
    runId: string,
    taskId: string,
    model: string,
    provider: string,
    skillId?: string,
  ): TelemetryBuilder {
    const builder = new TelemetryBuilder({ runId, taskId, skillId, model, provider })
    this.active.set(taskId, builder)
    return builder
  }

  /** Get the active builder for a task */
  getBuilder(taskId: string): TelemetryBuilder | undefined {
    return this.active.get(taskId)
  }

  /** End recording for a task and return the frozen telemetry */
  end(taskId: string): TaskTelemetry | undefined {
    const builder = this.active.get(taskId)
    if (!builder) return undefined
    const telemetry = builder.build()
    this.active.delete(taskId)
    this.completed.push(telemetry)
    return telemetry
  }

  /** Get all completed telemetry records */
  getCompleted(): TaskTelemetry[] {
    return [...this.completed]
  }

  /** Get telemetry for a specific run */
  getRunTelemetry(runId: string): TaskTelemetry[] {
    return this.completed.filter(t => t.identity.runId === runId)
  }

  /** Clear all recorded telemetry */
  clear(): void {
    this.active.clear()
    this.completed = []
  }
}
