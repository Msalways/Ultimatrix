import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'
import { getEngagementServices } from '../runtime/engagement-context'

interface ProviderQuota {
  used: number
  limit: number
  resetTime: number
  exhaustionCount: number
  lastExhaustion: number
  inCooldown: boolean
  cooldownUntil: number
}

const TERMINAL_COOLDOWN_MS = Number.MAX_SAFE_INTEGER

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

  checkRequest(provider: string, limit?: number): Error | undefined {
    if (this.isExhausted(provider)) {
      return new Error(`Provider ${provider} is exhausted for this session. Switch provider/model or reset provider health before retrying.`)
    }
    const q = this.getOrCreate(provider)
    if (limit !== undefined && limit > 0) {
      q.limit = limit
      if (q.used >= limit) {
        this.recordExhaustion(provider, TERMINAL_COOLDOWN_MS)
        return new Error(`Provider ${provider} request budget exhausted (${q.used}/${limit}). Switch provider/model or raise budgetPolicy.maxModelCallsPerTask.`)
      }
    }
    return undefined
  }

  admitRequest(provider: string, limit?: number): Error | undefined {
    const error = this.checkRequest(provider, limit)
    if (error) return error
    const q = this.getOrCreate(provider)
    q.used++
    return undefined
  }

  recordExhaustion(provider: string, cooldownMs = 60_000): void {
    const q = this.getOrCreate(provider)
    q.exhaustionCount++
    q.lastExhaustion = Date.now()
    q.inCooldown = true
    q.cooldownUntil = cooldownMs === TERMINAL_COOLDOWN_MS ? TERMINAL_COOLDOWN_MS : Date.now() + cooldownMs

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

export function getGlobalQuotaTracker(): QuotaTracker {
  const owned = getEngagementServices()?.quota
  if (owned) return owned
  throw new Error('getGlobalQuotaTracker() called outside engagement context')
}

export function resetGlobalQuotaTracker(): void {
  // Only for test cleanup - must be called within engagement context
  const owned = getEngagementServices()?.quota
  if (owned) {
    // Reset by creating a new one
    const svc = getEngagementServices()
    if (svc) svc.quota = new QuotaTracker()
  }
}
