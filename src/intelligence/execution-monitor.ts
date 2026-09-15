/**
 * Execution Monitor — auto mentor intervention when stuck.
 *
 * Detects patterns:
 *   - Identical tool calls ≥ 3 times → "try a different approach"
 *   - Same endpoint tested ≥ 5 times → "move to different endpoint"
 *   - No findings after 10 tool calls → "consider reconnaissance"
 *   - Stuck in recon loop → "start testing"
 *
 * Adapted from PentAGI execution_monitor.go + PWN mistakes.
 * Wired into anti-loop's getMandatoryInstruction() output.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type PatternType =
  | 'repeated_tool'
  | 'endpoint_saturated'
  | 'no_findings'
  | 'recon_loop'
  | 'stuck_injection'

export interface DetectedPattern {
  type: PatternType
  severity: 'info' | 'warning' | 'critical'
  message: string
  toolCall?: string
  endpoint?: string
  count?: number
}

export interface ToolCallRecord {
  toolName: string
  endpoint?: string
  arguments?: string
  success: boolean
  findingProduced: boolean
  timestamp: string
}

export interface MonitorConfig {
  /** Identical tool calls before intervention. Default: 3 */
  repeatedToolThreshold?: number
  /** Same endpoint tests before intervention. Default: 5 */
  endpointSaturationThreshold?: number
  /** Tool calls without findings before intervention. Default: 10 */
  noFindingsThreshold?: number
  /** Recon tool calls before suggesting testing. Default: 8 */
  reconLoopThreshold?: number
}

// ─── Tool Categories ────────────────────────────────────────────────

const RECON_TOOLS = new Set([
  'queryGraph', 'getTargetSummary', 'getEndpointsWithParams',
  'getGraphSchema', 'getGraphNeighborhood', 'getWorkflowAround',
  'traceValue', 'explainReachability', 'getCaptureOverview',
  'queryRelations', 'listSkills', 'searchSkills',
])

const INJECTION_TOOLS = new Set([
  'httpRequest', 'runPrimitive', 'verifyChains',
])

// ─── Monitor ────────────────────────────────────────────────────────

export class ExecutionMonitor {
  private history: ToolCallRecord[] = []
  private config: MonitorConfig

  constructor(config?: MonitorConfig) {
    this.config = {
      repeatedToolThreshold: config?.repeatedToolThreshold ?? 3,
      endpointSaturationThreshold: config?.endpointSaturationThreshold ?? 5,
      noFindingsThreshold: config?.noFindingsThreshold ?? 10,
      reconLoopThreshold: config?.reconLoopThreshold ?? 8,
    }
  }

  /** Record a tool call for monitoring. */
  recordCall(record: ToolCallRecord): void {
    this.history.push(record)
  }

  /** Detect stuck patterns and return intervention guidance. */
  detectPatterns(): DetectedPattern[] {
    const patterns: DetectedPattern[] = []

    // Pattern 1: Identical tool calls
    const repeated = this.detectRepeatedToolCalls()
    if (repeated) patterns.push(repeated)

    // Pattern 2: Endpoint saturated
    const saturated = this.detectEndpointSaturation()
    if (saturated) patterns.push(saturated)

    // Pattern 3: No findings after N calls
    const noFindings = this.detectNoFindings()
    if (noFindings) patterns.push(noFindings)

    // Pattern 4: Recon loop
    const reconLoop = this.detectReconLoop()
    if (reconLoop) patterns.push(reconLoop)

    // Pattern 5: Stuck in injection
    const stuckInjection = this.detectStuckInjection()
    if (stuckInjection) patterns.push(stuckInjection)

    return patterns
  }

  /** Get the most critical intervention message, if any. */
  getMandatoryInstruction(): string | null {
    const patterns = this.detectPatterns()
    if (patterns.length === 0) return null

    // Sort by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 }
    patterns.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    const most = patterns[0]
    return `[MENTOR] ${most.message}`
  }

  /** Get total call count. */
  getCallCount(): number {
    return this.history.length
  }

  /** Get finding count. */
  getFindingCount(): number {
    return this.history.filter(r => r.findingProduced).length
  }

  /** Reset history. */
  reset(): void {
    this.history = []
  }

  // ─── Pattern Detection ──────────────────────────────────────────

  private detectRepeatedToolCalls(): DetectedPattern | null {
    const recent = this.history.slice(-5)
    if (recent.length < this.config.repeatedToolThreshold!) return null

    // Check if the last N calls are the same tool
    const lastN = recent.slice(-this.config.repeatedToolThreshold!)
    const uniqueTools = new Set(lastN.map(r => r.toolName))

    if (uniqueTools.size === 1) {
      const tool = lastN[0].toolName
      return {
        type: 'repeated_tool',
        severity: 'warning',
        message: `You've called ${tool} ${lastN.length} times in a row. Try a different approach or tool.`,
        toolCall: tool,
        count: lastN.length,
      }
    }

    return null
  }

  private detectEndpointSaturation(): DetectedPattern | null {
    const endpointCounts = new Map<string, number>()
    for (const r of this.history) {
      if (r.endpoint) {
        endpointCounts.set(r.endpoint, (endpointCounts.get(r.endpoint) ?? 0) + 1)
      }
    }

    for (const [endpoint, count] of endpointCounts) {
      if (count >= this.config.endpointSaturationThreshold!) {
        return {
          type: 'endpoint_saturated',
          severity: 'warning',
          message: `Endpoint ${endpoint} has been tested ${count} times. Move to a different endpoint or try a different technique.`,
          endpoint,
          count,
        }
      }
    }

    return null
  }

  private detectNoFindings(): DetectedPattern | null {
    const total = this.history.length
    const findings = this.getFindingCount()

    if (total >= this.config.noFindingsThreshold! && findings === 0) {
      return {
        type: 'no_findings',
        severity: 'info',
        message: `${total} tool calls with no findings yet. Consider recon first or try a different attack vector.`,
        count: total,
      }
    }

    return null
  }

  private detectReconLoop(): DetectedPattern | null {
    const recent = this.history.slice(-this.config.reconLoopThreshold!)
    if (recent.length < this.config.reconLoopThreshold!) return null

    const reconCount = recent.filter(r => RECON_TOOLS.has(r.toolName)).length

    if (reconCount >= this.config.reconLoopThreshold! - 1) {
      return {
        type: 'recon_loop',
        severity: 'warning',
        message: `You've been doing recon for ${reconCount} calls. You have enough information — start testing specific endpoints.`,
        count: reconCount,
      }
    }

    return null
  }

  private detectStuckInjection(): DetectedPattern | null {
    const recent = this.history.slice(-6)
    if (recent.length < 4) return null

    const injectionCount = recent.filter(r => INJECTION_TOOLS.has(r.toolName)).length

    if (injectionCount >= 4 && injectionCount === recent.length) {
      return {
        type: 'stuck_injection',
        severity: 'critical',
        message: `All recent calls are injection attempts. If none are working, the endpoint may not be vulnerable. Try a different vulnerability class or move to another endpoint.`,
        count: injectionCount,
      }
    }

    return null
  }
}
