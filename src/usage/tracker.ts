import { log } from '../utils/logger'

export interface UsageEntry {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  timestamp: number
  /** @deprecated Use inputTokens/outputTokens instead */
  cost?: number
}

export class UsageTracker {
  private entries: UsageEntry[] = []

  record(provider: string, model: string, inputTokens: number, outputTokens: number, cost?: number): void {
    this.entries.push({
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost,
      timestamp: Date.now(),
    })
  }

  getTotal(): { inputTokens: number; outputTokens: number; totalTokens: number; calls: number } {
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    for (const e of this.entries) {
      inputTokens += e.inputTokens
      outputTokens += e.outputTokens
      totalTokens += e.totalTokens
    }
    return { inputTokens, outputTokens, totalTokens, calls: this.entries.length }
  }

  getByProvider(): Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; calls: number }> {
    const byProvider: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; calls: number }> = {}
    for (const e of this.entries) {
      if (!byProvider[e.provider]) byProvider[e.provider] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 }
      byProvider[e.provider].inputTokens += e.inputTokens
      byProvider[e.provider].outputTokens += e.outputTokens
      byProvider[e.provider].totalTokens += e.totalTokens
      byProvider[e.provider].calls++
    }
    return byProvider
  }

  getByModel(): Record<string, { provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; calls: number }> {
    const byModel: Record<string, { provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; calls: number }> = {}
    for (const e of this.entries) {
      const key = `${e.provider}/${e.model}`
      if (!byModel[key]) byModel[key] = { provider: e.provider, model: e.model, inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 }
      byModel[key].inputTokens += e.inputTokens
      byModel[key].outputTokens += e.outputTokens
      byModel[key].totalTokens += e.totalTokens
      byModel[key].calls++
    }
    return byModel
  }

  printSummary(): void {
    const total = this.getTotal()
    if (total.calls === 0) return
    log.info(`Usage: ${total.calls} calls, ${total.inputTokens.toLocaleString()} in / ${total.outputTokens.toLocaleString()} out (${total.totalTokens.toLocaleString()} total)`)
    const byModel = this.getByModel()
    for (const [key, stats] of Object.entries(byModel)) {
      log.dim(`  ${key}: ${stats.calls} calls, ${stats.inputTokens.toLocaleString()} in / ${stats.outputTokens.toLocaleString()} out`)
    }
  }

  reset(): void {
    this.entries = []
  }
}

let _globalTracker: UsageTracker | null = null

export function getGlobalUsageTracker(): UsageTracker {
  if (!_globalTracker) {
    _globalTracker = new UsageTracker()
  }
  return _globalTracker
}
