/**
 * Temporal Decay — exponential decay for cross-engagement patterns.
 *
 * Older engagements are weighted less. Formula:
 *   weight = baseWeight * exp(-lambda * daysSinceLastUse)
 *
 * Default half-life: ~70 days (lambda = 0.01)
 * Adapted from PWN metrics decay system.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface DecayConfig {
  /** Decay rate (lambda). Higher = faster decay. Default: 0.01 */
  lambda?: number
  /** Minimum weight threshold. Below this, weight is set to 0. Default: 0.01 */
  minWeight?: number
}

export interface Decayable {
  /** Base weight (0-1 range) */
  weight: number
  /** ISO timestamp of last update */
  lastUpdated: string
}

// ─── Core Functions ─────────────────────────────────────────────────

const DEFAULT_LAMBDA = 0.01
const DEFAULT_MIN_WEIGHT = 0.01

/**
 * Apply exponential decay to a weight based on time elapsed.
 *
 * @param weight - Base weight (0-1)
 * @param lastUpdated - ISO timestamp of last update
 * @param config - Decay configuration
 * @param now - Current time (injectable for testing)
 * @returns Decayed weight
 */
export function applyDecay(
  weight: number,
  lastUpdated: string,
  config?: DecayConfig,
  now?: Date,
): number {
  const lambda = config?.lambda ?? DEFAULT_LAMBDA
  const minWeight = config?.minWeight ?? DEFAULT_MIN_WEIGHT

  const currentTime = now ?? new Date()
  const lastUpdateTime = new Date(lastUpdated)

  // Days since last update (fractional)
  const msElapsed = currentTime.getTime() - lastUpdateTime.getTime()
  const daysElapsed = msElapsed / (1000 * 60 * 60 * 24)

  // Exponential decay
  const decayedWeight = weight * Math.exp(-lambda * daysElapsed)

  return decayedWeight < minWeight ? 0 : decayedWeight
}

/**
 * Apply decay to a map of weighted items.
 * Items with weight below threshold are removed.
 *
 * @param items - Map of item ID to { weight, lastUpdated }
 * @param config - Decay configuration
 * @param now - Current time (injectable for testing)
 * @returns Map with decayed weights, items below threshold removed
 */
export function applyDecayToMap<T extends Decayable>(
  items: Map<string, T>,
  config?: DecayConfig,
  now?: Date,
): Map<string, T & { decayedWeight: number }> {
  const result = new Map<string, T & { decayedWeight: number }>()

  for (const [id, item] of items) {
    const decayedWeight = applyDecay(item.weight, item.lastUpdated, config, now)
    if (decayedWeight > 0) {
      result.set(id, { ...item, decayedWeight })
    }
  }

  return result
}

/**
 * Calculate half-life in days from a decay constant.
 *
 * @param lambda - Decay constant
 * @returns Half-life in days
 */
export function halfLifeDays(lambda: number = DEFAULT_LAMBDA): number {
  return Math.log(2) / lambda
}

/**
 * Get the decay factor for a given number of days.
 *
 * @param days - Number of days
 * @param lambda - Decay constant
 * @returns Decay factor (0-1)
 */
export function decayFactor(days: number, lambda: number = DEFAULT_LAMBDA): number {
  return Math.exp(-lambda * days)
}
