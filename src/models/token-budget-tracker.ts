/**
 * Tracks token usage per task/worker against a budget.
 * Supports hard (throw), soft (warn + prune), and warn (log only) enforcement.
 */

export type BudgetEnforcement = 'hard' | 'soft' | 'warn'

export class TokenBudgetTracker {
  private maxTokens: number
  private maxModelCalls: number
  private usedTokens = 0
  private usedModelCalls = 0
  private enforcement: BudgetEnforcement
  private warnings: string[] = []

  constructor(
    maxTokens: number,
    maxModelCalls: number,
    enforcement: BudgetEnforcement = 'soft',
  ) {
    this.maxTokens = maxTokens === Infinity ? Number.MAX_SAFE_INTEGER : maxTokens
    this.maxModelCalls = maxModelCalls === Infinity ? Number.MAX_SAFE_INTEGER : maxModelCalls
    this.enforcement = enforcement
  }

  recordUsage(inputTokens: number, outputTokens: number): boolean {
    const tokens = inputTokens + outputTokens
    this.usedTokens += tokens
    this.usedModelCalls++

    if (this.isOverBudget()) {
      const msg = `Budget exceeded: ${this.usedTokens}/${this.maxTokens} tokens, ${this.usedModelCalls}/${this.maxModelCalls} calls`
      this.warnings.push(msg)

      if (this.enforcement === 'hard') {
        throw new Error(msg)
      }
      if (this.enforcement === 'soft') {
        return false // Signal to caller: budget exceeded, stop gracefully
      }
      // 'warn' — just log, keep going
    }
    return true // Budget OK
  }

  isOverBudget(): boolean {
    return this.usedTokens >= this.maxTokens || this.usedModelCalls >= this.maxModelCalls
  }

  isNearBudget(threshold = 0.2): boolean {
    const tokenRatio = this.usedTokens / this.maxTokens
    const callRatio = this.usedModelCalls / this.maxModelCalls
    return tokenRatio >= (1 - threshold) || callRatio >= (1 - threshold)
  }

  getRemaining(): { tokens: number; calls: number } {
    return {
      tokens: Math.max(0, this.maxTokens - this.usedTokens),
      calls: Math.max(0, this.maxModelCalls - this.usedModelCalls),
    }
  }

  getStatus(): {
    usedTokens: number
    maxTokens: number
    usedModelCalls: number
    maxModelCalls: number
    isOverBudget: boolean
    isNearBudget: boolean
    warnings: string[]
  } {
    return {
      usedTokens: this.usedTokens,
      maxTokens: this.maxTokens,
      usedModelCalls: this.usedModelCalls,
      maxModelCalls: this.maxModelCalls,
      isOverBudget: this.isOverBudget(),
      isNearBudget: this.isNearBudget(),
      warnings: [...this.warnings],
    }
  }

  toInstructionBlock(): string {
    const remaining = this.getRemaining()
    const used = this.usedModelCalls
    const total = this.maxModelCalls
    return [
      `## Your Token Budget`,
      `- Total allocation: ${this.maxTokens.toLocaleString()} tokens across ${total} model calls`,
      `- Used so far: ${this.usedTokens.toLocaleString()} tokens, ${used} calls`,
      `- Remaining: ${remaining.tokens.toLocaleString()} tokens, ${remaining.calls} calls`,
      this.isNearBudget()
        ? `⚠️ Budget is low (<20% remaining). Prefer balanced/fast tier for workers. Only spawn essential workers.`
        : '',
    ].filter(Boolean).join('\n')
  }

  reset(): void {
    this.usedTokens = 0
    this.usedModelCalls = 0
    this.warnings = []
  }
}
