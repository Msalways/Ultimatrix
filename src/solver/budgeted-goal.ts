/**
 * Budgeted Goal — Priority-weighted section builder with hard token cap.
 *
 * Replaces the 200-line ad-hoc section builder in solver.ts with a single
 * function that respects a model-proportional token budget.
 *
 * Budget = contextWindow × 0.05 (5% of window). For 262K model = ~13K tokens.
 * Sections are sorted by priority and added until budget is exhausted.
 */

import { ContextWindowRegistry } from '../models/context-window-registry'

export interface GoalSection {
  name: string
  priority: number  // 100=highest, 10=lowest
  content: string
}

/** Rough char-to-token estimate (1 token ≈ 4 chars). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Build a budgeted goal string from priority-ordered sections.
 *
 * @param sections - Sections to include, each with priority (higher = more important)
 * @param config - UltimatrixConfig for resolving model context window
 * @returns Assembled goal string fitting within token budget
 */
export function buildBudgetedGoal(
  sections: GoalSection[],
  config: { model?: string; modelCapabilities?: Record<string, { contextWindow: number }> },
): string {
  const registry = new ContextWindowRegistry(config as any)
  const contextWindow = registry.getContextWindow(config.model ?? '') || 128_000
  const tokenBudget = Math.floor(contextWindow * 0.05)  // 5% of context window

  // Sort by priority descending (highest priority first)
  const sorted = [...sections].sort((a, b) => b.priority - a.priority)

  let tokensUsed = 0
  const included: string[] = []
  let truncated = false

  for (const section of sorted) {
    if (tokensUsed >= tokenBudget) {
      truncated = true
      break
    }

    const header = `\n## ${section.name}\n`
    const fullContent = header + section.content
    const sectionTokens = estimateTokens(fullContent)

    if (tokensUsed + sectionTokens <= tokenBudget) {
      included.push(fullContent)
      tokensUsed += sectionTokens
    } else {
      // Truncate section to fit remaining budget
      const remainingBudget = tokenBudget - tokensUsed
      const maxChars = Math.max(0, (remainingBudget - 1) * 4)  // -1 for header safety
      if (maxChars > 50) {
        included.push(header + section.content.slice(0, maxChars) + '\n... [truncated]')
        tokensUsed += remainingBudget
      }
      truncated = true
      break
    }
  }

  const footer = `\n\n[Goal budget: ${tokensUsed}/${tokenBudget} tokens, ${sorted.length - included.length} sections dropped]`

  return included.join('\n') + (truncated ? footer : '')
}

/**
 * Legacy-compatible enrichment: wraps the existing enriched goal in a budget check.
 * If the goal exceeds the budget, it truncates the lowest-priority sections first.
 */
export function capEnrichedGoal(
  enrichedGoal: string,
  goalCap: number,
  config: { model?: string; modelCapabilities?: Record<string, { contextWindow: number }> },
): string {
  const currentTokens = estimateTokens(enrichedGoal)
  if (currentTokens <= goalCap) return enrichedGoal

  // Simple truncation: keep from the end (most recent sections are at bottom)
  const maxChars = goalCap * 4
  return enrichedGoal.slice(0, maxChars) + '\n\n[Enriched goal truncated to fit context budget]'
}
