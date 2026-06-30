import { log } from '../utils/logger'

interface UsageEntry {
  provider: string
  model: string
  tokens: number
  cost: number
  timestamp: number
}

class UsageTracker {
  private entries: UsageEntry[] = []

  record(provider: string, model: string, tokens: number, cost: number): void {
    this.entries.push({ provider, model, tokens, cost, timestamp: Date.now() })
  }

  getTotal(): { tokens: number; cost: number; calls: number } {
    let tokens = 0
    let cost = 0
    for (const e of this.entries) {
      tokens += e.tokens
      cost += e.cost
    }
    return { tokens, cost, calls: this.entries.length }
  }

  getByProvider(): Record<string, { tokens: number; cost: number; calls: number }> {
    const byProvider: Record<string, { tokens: number; cost: number; calls: number }> = {}
    for (const e of this.entries) {
      if (!byProvider[e.provider]) byProvider[e.provider] = { tokens: 0, cost: 0, calls: 0 }
      byProvider[e.provider].tokens += e.tokens
      byProvider[e.provider].cost += e.cost
      byProvider[e.provider].calls++
    }
    return byProvider
  }

  printSummary(): void {
    const total = this.getTotal()
    if (total.calls === 0) return
    log.info(`Usage: ${total.calls} calls, ${total.tokens.toLocaleString()} tokens, $${total.cost.toFixed(4)}`)
    const byProvider = this.getByProvider()
    for (const [provider, stats] of Object.entries(byProvider)) {
      log.dim(`  ${provider}: ${stats.calls} calls, ${stats.tokens.toLocaleString()} tokens, $${stats.cost.toFixed(4)}`)
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
