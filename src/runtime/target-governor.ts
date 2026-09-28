import { getEngagementServices } from './engagement-context'

export interface TargetGovernorOptions {
  requestsPerMinute: number
  maxConcurrent: number
  /**
   * Minimum spacing between two consecutive requests to the same origin.
   * A rolling-window budget alone admits a burst; this floor keeps a
   * single client from ever bursting, even when the window has room.
   */
  minIntervalMs?: number
}

export interface TargetGovernorStats {
  origin: string
  requestsInWindow: number
  active: number
  nextAvailableInMs: number
}

/**
 * Engagement-scoped target transport governor.
 *
 * This is deliberately separate from provider/model limiting: a model call
 * and a wire request to the target consume different budgets. The governor is
 * shared by HTTP, browser actions, raw transports, replay, and generated
 * request paths through the runtime container.
 */
export class TargetTransportGovernor {
  private readonly windows = new Map<string, number[]>()
  private readonly active = new Map<string, number>()
  private readonly lastRequestAt = new Map<string, number>()
  private readonly options: Required<TargetGovernorOptions>
  private readonly windowMs = 60_000

  constructor(options: TargetGovernorOptions) {
    this.options = {
      requestsPerMinute: Number.isFinite(options.requestsPerMinute) && options.requestsPerMinute > 0 ? options.requestsPerMinute : 60,
      maxConcurrent: Number.isFinite(options.maxConcurrent) && options.maxConcurrent > 0 ? options.maxConcurrent : 1,
      minIntervalMs: Number.isFinite(options.minIntervalMs ?? 200) && (options.minIntervalMs ?? 200) >= 0 ? (options.minIntervalMs ?? 200) : 200,
    }
  }

  private originOf(url: string): string {
    try { return new URL(url).origin } catch { return url }
  }

  private prune(origin: string, now: number): number[] {
    const cutoff = now - this.windowMs
    const values = (this.windows.get(origin) ?? []).filter((timestamp) => timestamp > cutoff)
    this.windows.set(origin, values)
    return values
  }

  /** Wait for a per-origin wire slot and return its idempotent release function. */
  async acquire(url: string): Promise<() => void> {
    const origin = this.originOf(url)
    while (true) {
      const now = Date.now()
      const values = this.prune(origin, now)
      const active = this.active.get(origin) ?? 0
      const last = this.lastRequestAt.get(origin)
      const spacingWait = last === undefined ? 0 : Math.max(0, last + this.options.minIntervalMs - now)

      const withinWindow = values.length < this.options.requestsPerMinute
      const withinConcurrency = active < this.options.maxConcurrent
      if (withinWindow && withinConcurrency && spacingWait === 0) {
        values.push(now)
        this.windows.set(origin, values)
        this.lastRequestAt.set(origin, now)
        this.active.set(origin, active + 1)
        let released = false
        return () => {
          if (released) return
          released = true
          this.active.set(origin, Math.max(0, (this.active.get(origin) ?? 1) - 1))
        }
      }

      // Both the rolling-window budget and the pacing floor are satisfied by
      // waiting for the longest of the applicable constraints. A window that
      // is not yet full imposes no wait.
      const rateWait = withinWindow ? 0 : Math.max(0, values[0] + this.windowMs - now)
      const wait = Math.max(spacingWait, rateWait, withinConcurrency ? 0 : 25, 10)
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 1000)))
    }
  }

  async run<T>(url: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(url)
    try { return await operation() } finally { release() }
  }

  stats(url: string): TargetGovernorStats {
    const origin = this.originOf(url)
    const now = Date.now()
    const values = this.prune(origin, now)
    const windowWait = values.length >= this.options.requestsPerMinute ? Math.max(0, values[0] + this.windowMs - now) : 0
    const last = this.lastRequestAt.get(origin)
    const spacingWait = last === undefined ? 0 : Math.max(0, last + this.options.minIntervalMs - now)
    return {
      origin,
      requestsInWindow: values.length,
      active: this.active.get(origin) ?? 0,
      nextAvailableInMs: Math.max(windowWait, spacingWait),
    }
  }
}

let legacyGovernor: TargetTransportGovernor | null = null

/** Runtime-owned governor; the module fallback exists only for legacy callers. */
export function getTargetTransportGovernor(): TargetTransportGovernor {
  const owned = getEngagementServices()?.targetGovernor
  if (owned) return owned
  legacyGovernor ??= new TargetTransportGovernor({ requestsPerMinute: 60, maxConcurrent: 1 })
  return legacyGovernor
}
