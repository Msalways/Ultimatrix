/**
 * Budget Pressure — tiered degradation when token budget is tight.
 *
 * Pressure levels:
 *   normal:   < 80% consumed → full capabilities
 *   elevated: 80-95% consumed → skip exploitation loop + council
 *   critical: > 95% consumed → core tools only, no spawning
 *
 * Never hard-abort. Always finish current tool call.
 * Adapted from PentAGI tool_call_limits.go.
 */

export type BudgetPressureLevel = 'normal' | 'elevated' | 'critical'

export interface BudgetPressureConfig {
  elevatedThreshold?: number  // Default: 0.80
  criticalThreshold?: number // Default: 0.95
}

/**
 * Calculate pressure level from usage ratio (0-1).
 */
export function getPressureLevel(
  usedRatio: number,
  config?: BudgetPressureConfig,
): BudgetPressureLevel {
  const critical = config?.criticalThreshold ?? 0.95
  const elevated = config?.elevatedThreshold ?? 0.80

  if (usedRatio >= critical) return 'critical'
  if (usedRatio >= elevated) return 'elevated'
  return 'normal'
}

/**
 * Get human-readable description of what's degraded at this pressure level.
 */
export function describePressure(level: BudgetPressureLevel): string {
  switch (level) {
    case 'normal':
      return 'Full capabilities available.'
    case 'elevated':
      return 'Budget elevated — skipping exploitation loop and council debate to preserve remaining budget.'
    case 'critical':
      return 'Budget critical — core tools only, no worker spawning. Finish current work.'
  }
}

/**
 * Check if a specific capability is allowed at the given pressure level.
 */
export function isCapabilityAllowed(
  level: BudgetPressureLevel,
  capability: 'exploitation_loop' | 'council' | 'worker_spawning' | 'campaign' | 'core_tools',
): boolean {
  switch (level) {
    case 'normal':
      return true
    case 'elevated':
      return capability === 'core_tools'
    case 'critical':
      return capability === 'core_tools'
  }
}
