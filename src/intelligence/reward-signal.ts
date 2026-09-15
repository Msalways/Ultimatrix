/**
 * Reward Signal — scores tool outcomes for a process reward model.
 *
 * +1: Confirmed finding (EvidenceGate verified)
 *  0: Neutral (no finding, no error)
 * -1: Error/failure/timeout
 *
 * Per-tool success rates feed into technique registry weights.
 * Adapted from PWN reinforcement_learning.md.
 */

export type RewardScore = 1 | 0 | -1

export interface ToolReward {
  toolName: string
  score: RewardScore
  reason: string
  technique?: string
  endpoint?: string
  timestamp: string
}

export interface RewardSummary {
  toolName: string
  totalRewards: number
  positiveCount: number
  neutralCount: number
  negativeCount: number
  averageScore: number
  successRate: number
}

export class RewardSignalManager {
  private rewards: ToolReward[] = []

  /** Record a tool reward. */
  record(toolName: string, score: RewardScore, reason: string, technique?: string, endpoint?: string): ToolReward {
    const reward: ToolReward = {
      toolName, score, reason, technique, endpoint,
      timestamp: new Date().toISOString(),
    }
    this.rewards.push(reward)
    return reward
  }

  /** Get summary for a specific tool. */
  getSummary(toolName: string): RewardSummary {
    const toolRewards = this.rewards.filter(r => r.toolName === toolName)
    const positiveCount = toolRewards.filter(r => r.score === 1).length
    const neutralCount = toolRewards.filter(r => r.score === 0).length
    const negativeCount = toolRewards.filter(r => r.score === -1).length
    const total = toolRewards.length

    return {
      toolName,
      totalRewards: total,
      positiveCount,
      neutralCount,
      negativeCount,
      averageScore: total > 0 ? toolRewards.reduce((s, r) => s + r.score, 0) / total : 0,
      successRate: total > 0 ? positiveCount / total : 0,
    }
  }

  /** Get summaries for all tools. */
  getAllSummaries(): RewardSummary[] {
    const toolNames = new Set(this.rewards.map(r => r.toolName))
    return Array.from(toolNames).map(name => this.getSummary(name))
  }

  /** Get recent rewards (last N). */
  getRecent(count: number = 10): ToolReward[] {
    return this.rewards.slice(-count)
  }

  /** Get all rewards. */
  getAll(): ToolReward[] {
    return this.rewards
  }

  /** Reset. */
  clear(): void {
    this.rewards = []
  }
}
