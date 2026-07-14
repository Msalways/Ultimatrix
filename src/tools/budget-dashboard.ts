/**
 * BudgetDashboard — aggregates forensic log events into session-level
 * budget/usage summaries. Read-only: does not mutate the forensic log.
 */

import type { ForensicEvent, ForensicLog } from '../logging/forensic-log'
import type { BudgetPolicy } from '../config'

export interface TokenEntry {
  timestamp: number
  provider: string
  modelId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  toolName?: string
  agentRole?: string
}

export interface ProviderBreakdown {
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface ModelBreakdown {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AgentRoleBreakdown {
  calls: number
  tokens: number
}

export interface TaskBreakdown {
  task: string
  calls: number
  tokens: number
  tools: string[]
}

export interface RateLimitStatus {
  used: number
  remaining: number
  inCooldown: boolean
}

export interface SessionBudgetSummary {
  totalModelCalls: number
  totalTokens: { input: number; output: number; total: number }
  byProvider: Record<string, ProviderBreakdown>
  byAgentRole: Record<string, AgentRoleBreakdown>
  byModel: Record<string, ModelBreakdown>
  byTask: TaskBreakdown[]
  rateLimitStatus: Record<string, RateLimitStatus>
  warnings: string[]
}

export class BudgetDashboard {
  private forensicLog: ForensicLog
  private budgetPolicy: BudgetPolicy
  private tokenHistory: TokenEntry[] = []

  constructor(forensicLog: ForensicLog, budgetPolicy: BudgetPolicy) {
    this.forensicLog = forensicLog
    this.budgetPolicy = budgetPolicy
    this.buildFromLog()
  }

  private buildFromLog(): void {
    const events = this.forensicLog.getEvents({ type: 'model-call' })

    for (const event of events) {
      const meta = event.metadata
      if (!meta) continue

      this.tokenHistory.push({
        timestamp: event.timestamp,
        provider: meta.provider || 'unknown',
        modelId: meta.modelId || 'unknown',
        inputTokens: meta.inputTokens || 0,
        outputTokens: meta.outputTokens || 0,
        totalTokens: meta.totalTokens || 0,
        toolName: event.tool,
        agentRole: event.agent,
      })
    }
  }

  /**
   * Record a model call from external code (middleware, solver, etc.)
   */
  recordModelCall(entry: TokenEntry): void {
    this.tokenHistory.push(entry)
  }

  getSessionSummary(): SessionBudgetSummary {
    const byProvider: Record<string, ProviderBreakdown> = {}
    const byAgentRole: Record<string, AgentRoleBreakdown> = {}
    const byModel: Record<string, ModelBreakdown> = {}
    const toolSet = new Set<string>()
    const warnings: string[] = []

    let totalInput = 0
    let totalOutput = 0
    let totalTokens = 0
    let totalModelCalls = 0

    for (const entry of this.tokenHistory) {
      totalModelCalls++
      totalInput += entry.inputTokens
      totalOutput += entry.outputTokens
      totalTokens += entry.totalTokens

      // By provider
      if (!byProvider[entry.provider]) {
        byProvider[entry.provider] = { calls: 0, inputTokens: 0, outputTokens: 0 }
      }
      byProvider[entry.provider].calls++
      byProvider[entry.provider].inputTokens += entry.inputTokens
      byProvider[entry.provider].outputTokens += entry.outputTokens

      // By model (provider/model) — surfaces which concrete model served each
      // task, so tier allocation (e.g. powerful actually used) is observable.
      const modelKey = `${entry.provider}/${entry.modelId}`
      if (!byModel[modelKey]) {
        byModel[modelKey] = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      }
      byModel[modelKey].calls++
      byModel[modelKey].inputTokens += entry.inputTokens
      byModel[modelKey].outputTokens += entry.outputTokens
      byModel[modelKey].totalTokens += entry.totalTokens

      // By agent role
      if (entry.agentRole) {
        if (!byAgentRole[entry.agentRole]) {
          byAgentRole[entry.agentRole] = { calls: 0, tokens: 0 }
        }
        byAgentRole[entry.agentRole].calls++
        byAgentRole[entry.agentRole].tokens += entry.totalTokens
      }

      // Tool tracking
      if (entry.toolName) {
        toolSet.add(entry.toolName)
      }
    }

    // Budget warnings
    if (this.budgetPolicy.maxTokensPerSession && totalTokens >= this.budgetPolicy.maxTokensPerSession) {
      warnings.push(`Token budget exceeded: ${totalTokens}/${this.budgetPolicy.maxTokensPerSession}`)
    }
    if (totalModelCalls >= this.budgetPolicy.maxModelCallsPerTask) {
      warnings.push(`Model call budget exceeded: ${totalModelCalls}/${this.budgetPolicy.maxModelCallsPerTask}`)
    }

    // Rate limit events
    const rateLimitEvents = this.forensicLog.getEvents({ type: 'rate-limit-event' })
    const rateLimitStatus: Record<string, RateLimitStatus> = {}
    for (const event of rateLimitEvents) {
      const provider = event.metadata?.provider || event.args?.provider as string || 'unknown'
      if (!rateLimitStatus[provider]) {
        rateLimitStatus[provider] = { used: 0, remaining: Infinity, inCooldown: false }
      }
      const rl = rateLimitStatus[provider]
      if (event.metadata?.rateLimitUsed !== undefined) rl.used = event.metadata.rateLimitUsed
      if (event.metadata?.rateLimitRemaining !== undefined) rl.remaining = event.metadata.rateLimitRemaining
      if (event.args?.inCooldown) rl.inCooldown = true
    }

    return {
      totalModelCalls,
      totalTokens: { input: totalInput, output: totalOutput, total: totalTokens },
      byProvider,
      byAgentRole,
      byModel,
      byTask: [], // Tasks require richer context; populated by external callers
      rateLimitStatus,
      warnings,
    }
  }

  getTokenHistory(): TokenEntry[] {
    return [...this.tokenHistory]
  }

  /**
   * Pretty-print a live dashboard to console during session.
   */
  printLiveDashboard(): void {
    const summary = this.getSessionSummary()
    const lines = [
      `\n╔══════════════════════════════════════╗`,
      `║        BUDGET DASHBOARD              ║`,
      `╠══════════════════════════════════════╣`,
      `║ Model calls: ${String(summary.totalModelCalls).padEnd(23)}║`,
      `║ Input tokens:  ${String(summary.totalTokens.input).padEnd(22)}║`,
      `║ Output tokens: ${String(summary.totalTokens.output).padEnd(22)}║`,
      `║ Total tokens:  ${String(summary.totalTokens.total).padEnd(22)}║`,
    ]

    // Per-provider
    const providers = Object.entries(summary.byProvider)
    if (providers.length > 0) {
      lines.push(`╠══════════════════════════════════════╣`)
      lines.push(`║ BY PROVIDER                          ║`)
      for (const [name, data] of providers) {
        lines.push(`║ ${name}: ${data.calls} calls, ${data.inputTokens + data.outputTokens} tok`.padEnd(39) + `║`)
      }
    }

    // Per-model — which concrete model served each task (tier allocation proof)
    const models = Object.entries(summary.byModel)
    if (models.length > 0) {
      lines.push(`╠══════════════════════════════════════╣`)
      lines.push(`║ BY MODEL                             ║`)
      for (const [name, data] of models) {
        const label = `${name}: ${data.calls}c/${data.totalTokens}tok`
        lines.push(`║ ${label}`.padEnd(39) + `║`)
      }
    }

    // Per-agent role
    const roles = Object.entries(summary.byAgentRole)
    if (roles.length > 0) {
      lines.push(`╠══════════════════════════════════════╣`)
      lines.push(`║ BY AGENT ROLE                        ║`)
      for (const [name, data] of roles) {
        lines.push(`║ ${name}: ${data.calls} calls, ${data.tokens} tok`.padEnd(39) + `║`)
      }
    }

    // Warnings
    if (summary.warnings.length > 0) {
      lines.push(`╠══════════════════════════════════════╣`)
      for (const w of summary.warnings) {
        lines.push(`║ ⚠ ${w}`.padEnd(39) + `║`)
      }
    }

    lines.push(`╚══════════════════════════════════════╝`)
    console.log(lines.join('\n'))
  }

  /**
   * Get summary as a compact string.
   */
  toInstructionBlock(): string {
    const s = this.getSessionSummary()
    const budget = this.budgetPolicy
    const lines = [
      `## Budget Status`,
      `- Model calls: ${s.totalModelCalls}/${budget.maxModelCallsPerTask}`,
      `- Tokens: ${s.totalTokens.total} (in: ${s.totalTokens.input}, out: ${s.totalTokens.output})`,
    ]

    if (budget.maxTokensPerSession) {
      lines.push(`- Token budget: ${s.totalTokens.total}/${budget.maxTokensPerSession}`)
    }

    if (s.warnings.length > 0) {
      lines.push(`- Warnings: ${s.warnings.join('; ')}`)
    }

    const models = Object.entries(s.byModel)
    if (models.length > 0) {
      lines.push(`- By model:`)
      for (const [name, data] of models) {
        lines.push(`  - ${name}: ${data.calls} calls, ${data.totalTokens} tokens`)
      }
    }

    return lines.join('\n')
  }
}
