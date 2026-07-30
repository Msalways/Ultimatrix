/**
 * Validates that a request fits within the model's context window.
 * Estimates token counts from text, warns when tight, auto-truncates if needed.
 */

import type {ModelCapabilities} from '../config'
import { compactText } from '../output/compaction'
import type { ContextWindowRegistry } from './context-window-registry'

export interface ContextFitParams {
  modelId: string
  systemPrompt: string
  toolSchemas: string
  conversationHistory: string
  enrichedGoal: string
  expectedOutputTokens?: number
}

export interface ContextValidation {
  fits: boolean
  totalInputTokens: number
  availableForOutput: number
  breakdown: {
    system: number
    tools: number
    history: number
    goal: number
  }
  suggestions: string[]
  severity: 'ok' | 'warning' | 'critical'
}

const DEFAULT_CONTEXT_WINDOW = 8192
const DEFAULT_MAX_OUTPUT = 2048
const WARNING_THRESHOLD = 0.85   // warn at 85% full
const CRITICAL_THRESHOLD = 0.97  // critical at 97% full

// Rough token estimation: ~words × 1.3, with adjustment for code/special chars
function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0
  // Split on whitespace for word count, apply multiplier
  const words = text.split(/\s+/).filter(Boolean).length
  // Code blocks and special chars tend to tokenize more
  const codeOverhead = (text.match(/[{}[\]();=<>!&|]/g)?.length ?? 0) * 0.1
  return Math.ceil(words * 1.3 + codeOverhead)
}

export class ContextBudgetManager {
  private capabilities: ModelCapabilities
  private registry: ContextWindowRegistry | null

  constructor(capabilities: ModelCapabilities, registry?: ContextWindowRegistry) {
    this.capabilities = capabilities
    this.registry = registry ?? null
  }

  /**
   * Rough token count for a string. Words × 1.3 + code overhead.
   */
  estimateTokens(text: string): number {
    return estimateTokens(text)
  }

  /**
   * Validate that the request fits within the model's context window.
   * Returns a breakdown and severity so callers can decide what to do.
   */
  validateContextFit(params: ContextFitParams): ContextValidation {
    const caps = this.capabilities[params.modelId]
    const contextWindow = caps?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const maxOutput = caps?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT
    const reservedOutput = params.expectedOutputTokens ?? maxOutput

    const systemTokens = estimateTokens(params.systemPrompt)
    const toolsTokens = estimateTokens(params.toolSchemas)
    const historyTokens = estimateTokens(params.conversationHistory)
    const goalTokens = estimateTokens(params.enrichedGoal)

    const totalInputTokens = systemTokens + toolsTokens + historyTokens + goalTokens
    const availableForOutput = Math.max(0, contextWindow - totalInputTokens - reservedOutput)

    const utilization = contextWindow > 0 ? totalInputTokens / contextWindow : 1

    let severity: ContextValidation['severity']
    if (utilization >= CRITICAL_THRESHOLD) {
      severity = 'critical'
    } else if (utilization >= WARNING_THRESHOLD) {
      severity = 'warning'
    } else {
      severity = 'ok'
    }

    const fits = totalInputTokens + reservedOutput <= contextWindow
    const suggestions = this.suggestReductions(
      { system: systemTokens, tools: toolsTokens, history: historyTokens, goal: goalTokens },
      availableForOutput,
      contextWindow,
    )

    return {
      fits,
      totalInputTokens,
      availableForOutput,
      breakdown: {
        system: systemTokens,
        tools: toolsTokens,
        history: historyTokens,
        goal: goalTokens,
      },
      suggestions,
      severity,
    }
  }

  /**
   * Produce actionable suggestions to reduce token usage when context is tight.
   */
  suggestReductions(
    breakdown: { system: number; tools: number; history: number; goal: number },
    available: number,
    contextWindow: number,
  ): string[] {
    const suggestions: string[] = []
    const total = breakdown.system + breakdown.tools + breakdown.history + breakdown.goal
    const overflow = total - contextWindow * WARNING_THRESHOLD

    if (overflow <= 0) return suggestions

    // Biggest contributor first
    const raw: [string, number][] = [
      ['history', breakdown.history],
      ['goal', breakdown.goal],
      ['tools', breakdown.tools],
      ['system', breakdown.system],
    ]
    const entries = raw.sort((a, b) => b[1] - a[1])

    let remaining = overflow
    for (const [key, tokens] of entries) {
      if (remaining <= 0) break
      if (tokens === 0) continue
      const reduction = Math.min(tokens, remaining)
      const pct = Math.round((reduction / tokens) * 100)
      suggestions.push(`Reduce ${key} by ~${pct}% (${reduction} tokens)`)
      remaining -= reduction
    }

    if (available <= 0) {
      suggestions.push('Context will overflow — consider spawning a worker for delegation')
    }

    return suggestions
  }

  /**
   * Auto-truncate params to fit within a target token budget.
   * Returns new params with truncated strings.
   */
  truncateToFit(params: ContextFitParams, targetBudget?: number): ContextFitParams {
    const caps = this.capabilities[params.modelId]
    const contextWindow = caps?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const budget = targetBudget ?? Math.floor(contextWindow * 0.85) // 85% of window

    const systemTokens = estimateTokens(params.systemPrompt)
    const toolsTokens = estimateTokens(params.toolSchemas)
    const reserved = systemTokens + toolsTokens + (params.expectedOutputTokens ?? DEFAULT_MAX_OUTPUT)

    // Available budget for history + goal
    const inputBudget = Math.max(2000, budget - reserved)

    // Split input budget: 60% goal, 40% history
    const goalBudget = Math.floor(inputBudget * 0.6)
    const historyBudget = Math.floor(inputBudget * 0.4)

    return {
      ...params,
      conversationHistory: truncateToTokens(params.conversationHistory, historyBudget),
      enrichedGoal: truncateToTokens(params.enrichedGoal, goalBudget),
    }
  }

  /**
   * Get context window size for a model.
   * Resolution: registry → capabilities → null (no hardcoded fallback).
   */
  getContextWindow(modelId: string): number {
    const fromRegistry = this.registry?.getContextWindow(modelId)
    if (fromRegistry && fromRegistry > 0) return fromRegistry
    return this.capabilities[modelId]?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  }

  /**
   * Get max output tokens for a model.
   * Resolution: registry → capabilities → default.
   */
  getMaxOutput(modelId: string): number {
    const fromRegistry = this.registry?.getMaxOutput(modelId)
    if (fromRegistry && fromRegistry > 0) return fromRegistry
    return this.capabilities[modelId]?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT
  }
}

/**
 * Truncate text to approximately the given token budget.
 * Uses section-aware compaction (head+tail fallback) — never a blind tail-drop.
 */
function truncateToTokens(text: string, tokenBudget: number): string {
  if (!text || tokenBudget <= 0) return ''
  const result = compactText(text, { tokenBudget, strategy: 'section-aware' })
  return result.text
}
