import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

export type ForensicEventType =
  | 'tool-call' | 'tool-result' | 'tool-error'
  | 'http-request' | 'http-response'
  | 'graph-mutation' | 'agent-turn' | 'error'
  | 'human-action' | 'screenshot'
  | 'model-call' | 'rate-limit-event' | 'budget-status'
  | 'tool-token-record' | 'config-mismatch'
  | 'model-selection' | 'context-validation'
  | 'solver-phase' | 'ui-reaction' | 'council-timeout'
  | 'render-trace'

export interface ForensicEventMetadata {
  provider?: string
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  budgetRemaining?: number
  rateLimitUsed?: number
  rateLimitRemaining?: number
  toolCount?: number
  prunedTools?: string[]
  contextFit?: 'ok' | 'warning' | 'critical'
  enforcement?: 'hard' | 'soft' | 'warn'
  durationMs?: number
  tier?: string
  phase?: string
  tokensSaved?: number
  strategies?: string[]
}

export interface ForensicEvent {
  timestamp: number
  type: ForensicEventType
  agent: string
  tool?: string
  args?: Record<string, unknown>
  result?: unknown
  duration?: number
  error?: string
  metadata?: ForensicEventMetadata
}

export interface ForensicIndex {
  events: ForensicEvent[]
  totalEvents: number
  toolCalls: number
  httpRequests: number
  graphMutations: number
  humanActions: number
  screenshots: number
  errors: number
  modelCalls: number
  budgetStatuses: number
  rateLimitEvents: number
  modelSelections: number
  contextValidations: number
}

export class ForensicLog {
  private filePath: string
  private index: ForensicIndex = {
    events: [],
    totalEvents: 0,
    toolCalls: 0,
    httpRequests: 0,
    graphMutations: 0,
    humanActions: 0,
    screenshots: 0,
    errors: 0,
    modelCalls: 0,
    budgetStatuses: 0,
    rateLimitEvents: 0,
    modelSelections: 0,
    contextValidations: 0,
  }
  private truncationLimit: number

  constructor(filePath: string, opts?: { truncationLimit?: number }) {
    this.filePath = filePath
    this.truncationLimit = opts?.truncationLimit ?? 50_000

    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  log(event: Omit<ForensicEvent, 'timestamp'>): void {
    const fullEvent: ForensicEvent = {
      ...event,
      timestamp: Date.now(),
    }

    this.index.events.push(fullEvent)
    this.index.totalEvents++

    if (event.type === 'tool-call' || event.type === 'tool-result') {
      this.index.toolCalls++
    }
    if (event.type === 'http-request' || event.type === 'http-response') {
      this.index.httpRequests++
    }
    if (event.type === 'graph-mutation') {
      this.index.graphMutations++
    }
    if (event.type === 'human-action') {
      this.index.humanActions++
    }
    if (event.type === 'screenshot') {
      this.index.screenshots++
    }
    if (event.type === 'error' || event.type === 'tool-error') {
      this.index.errors++
    }
    if (event.type === 'model-call') {
      this.index.modelCalls++
    }
    if (event.type === 'budget-status') {
      this.index.budgetStatuses++
    }
    if (event.type === 'rate-limit-event') {
      this.index.rateLimitEvents++
    }
    if (event.type === 'model-selection') {
      this.index.modelSelections++
    }
    if (event.type === 'context-validation') {
      this.index.contextValidations++
    }

    // Append to NDJSON file (crash-safe)
    try {
      appendFileSync(this.filePath, JSON.stringify(fullEvent) + '\n', 'utf-8')
    } catch {
      // File write failure should not crash the agent
    }
  }

  getEvents(opts?: { type?: ForensicEventType; tool?: string; limit?: number }): ForensicEvent[] {
    let events = this.index.events
    if (opts?.type) {
      events = events.filter(e => e.type === opts.type)
    }
    if (opts?.tool) {
      events = events.filter(e => e.tool === opts.tool)
    }
    if (opts?.limit) {
      events = events.slice(-opts.limit)
    }
    return events
  }

  getIndex(): ForensicIndex {
    return { ...this.index }
  }

  getFullTimeline(): string {
    const lines = this.index.events.map(e => {
      const ts = new Date(e.timestamp).toISOString()
      const tool = e.tool ? `[${e.tool}]` : ''
      const dur = e.duration ? ` (${e.duration}ms)` : ''
      const err = e.error ? ` ERROR: ${e.error}` : ''
      let detail = ''

      if (e.args) {
        const argsStr = JSON.stringify(e.args)
        detail = argsStr.length > this.truncationLimit
          ? argsStr.substring(0, this.truncationLimit) + '...[truncated]'
          : argsStr
      }

      return `${ts} ${e.type} ${tool}${dur}${err} ${detail}`
    })
    return lines.join('\n')
  }

  getSummary(): string {
    const idx = this.index
    const duration = idx.events.length > 0
      ? idx.events[idx.events.length - 1].timestamp - idx.events[0].timestamp
      : 0

    return [
      `Forensic Log Summary`,
      `Total events: ${idx.totalEvents}`,
      `Tool calls: ${idx.toolCalls}`,
      `HTTP requests: ${idx.httpRequests}`,
      `Graph mutations: ${idx.graphMutations}`,
      `Human actions: ${idx.humanActions}`,
      `Screenshots: ${idx.screenshots}`,
      `Errors: ${idx.errors}`,
      `Model calls: ${idx.modelCalls}`,
      `Budget statuses: ${idx.budgetStatuses}`,
      `Rate limit events: ${idx.rateLimitEvents}`,
      `Model selections: ${idx.modelSelections}`,
      `Context validations: ${idx.contextValidations}`,
      `Duration: ${(duration / 1000).toFixed(1)}s`,
    ].join('\n')
  }
}
