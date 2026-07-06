import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'

interface ProviderQuota {
  used: number
  limit: number
  resetTime: number
  exhaustionCount: number
  lastExhaustion: number
  inCooldown: boolean
  cooldownUntil: number
}

/**
 * Tracks per-provider quota usage and exhaustion state.
 * Provides observability into rate limit health across providers.
 */
export class QuotaTracker {
  private providers = new Map<string, ProviderQuota>()

  recordRequest(provider: string): void {
    const q = this.getOrCreate(provider)
    q.used++
  }

  recordExhaustion(provider: string, cooldownMs = 60_000): void {
    const q = this.getOrCreate(provider)
    q.exhaustionCount++
    q.lastExhaustion = Date.now()
    q.inCooldown = true
    q.cooldownUntil = Date.now() + cooldownMs

    log.warn(`Quota exhausted [${provider}]: exhaustion #${q.exhaustionCount}, cooldown ${cooldownMs}ms`)

    getForensicLog()?.log({
      type: 'tool-error',
      agent: provider,
      tool: 'quota-tracker',
      error: `Exhaustion #${q.exhaustionCount}, cooldown ${cooldownMs}ms`,
    })
  }

  isExhausted(provider: string): boolean {
    const q = this.providers.get(provider)
    if (!q) return false

    if (q.inCooldown && Date.now() > q.cooldownUntil) {
      q.inCooldown = false
    }
    return q.inCooldown
  }

  resetExhaustion(provider: string): void {
    const q = this.providers.get(provider)
    if (q) {
      q.inCooldown = false
      q.cooldownUntil = 0
    }
  }

  updateLimit(provider: string, limit: number, resetTime?: number): void {
    const q = this.getOrCreate(provider)
    q.limit = limit
    if (resetTime !== undefined) q.resetTime = resetTime
  }

  getStatus(): Record<string, {
    used: number
    limit: number
    resetTime: number
    exhaustionCount: number
    lastExhaustion: number
    inCooldown: boolean
  }> {
    const result: Record<string, any> = {}
    for (const [provider, q] of this.providers) {
      // Auto-clear expired cooldowns
      if (q.inCooldown && Date.now() > q.cooldownUntil) {
        q.inCooldown = false
      }
      result[provider] = {
        used: q.used,
        limit: q.limit,
        resetTime: q.resetTime,
        exhaustionCount: q.exhaustionCount,
        lastExhaustion: q.lastExhaustion,
        inCooldown: q.inCooldown,
      }
    }
    return result
  }

  reset(): void {
    this.providers.clear()
  }

  private getOrCreate(provider: string): ProviderQuota {
    let q = this.providers.get(provider)
    if (!q) {
      q = {
        used: 0,
        limit: 0,
        resetTime: 0,
        exhaustionCount: 0,
        lastExhaustion: 0,
        inCooldown: false,
        cooldownUntil: 0,
      }
      this.providers.set(provider, q)
    }
    return q
  }
}

let _globalQuotaTracker: QuotaTracker | null = null

export function getGlobalQuotaTracker(): QuotaTracker {
  if (!_globalQuotaTracker) {
    _globalQuotaTracker = new QuotaTracker()
  }
  return _globalQuotaTracker
}

export function resetGlobalQuotaTracker(): void {
  _globalQuotaTracker = null
}
