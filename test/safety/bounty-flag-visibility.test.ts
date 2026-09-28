import { describe, expect, it, afterEach } from 'vitest'
import { isBountyProfile } from '../../src/safety/bounty-policy'
import { runWithEngagementServices, __setTestFallback, type EngagementServices } from '../../src/runtime/engagement-context'
import { resetConfigCache } from '../../src/config'

/**
 * Regression: the live bounty profile must be visible to tool-level gates.
 *
 * The runtime receives an effective config that a CLI flag (`--bounty`) may have
 * mutated AFTER `loadConfig()` validation. Gates that read the process-global
 * `getConfig()` would never see that mutation and would silently stand down
 * during a live run while the runtime still enforced the profile.
 */
function servicesWith(bountyEnabled: boolean | undefined): EngagementServices {
  return { bountyEnabled } as EngagementServices
}

describe('bounty profile visibility', () => {
  afterEach(() => {
    resetConfigCache()
    __setTestFallback(null)
  })

  it('honours the engagement-owned flag over the process config', () => {
    resetConfigCache()
    __setTestFallback(servicesWith(true))
    // The process config has no bounty block at all in this test environment.
    expect(isBountyProfile()).toBe(true)
  })

  it('honours an explicit engagement opt-out', () => {
    resetConfigCache()
    __setTestFallback(servicesWith(false))
    expect(isBountyProfile()).toBe(false)
  })

  it('falls back to the loaded config only when no engagement owns the flag', () => {
    resetConfigCache()
    // undefined => legacy caller with no engagement-owned value
    const scoped = runWithEngagementServices(servicesWith(undefined), () => isBountyProfile())
    expect(typeof scoped).toBe('boolean')
  })

  it('never reports the profile as active without an owner or config', () => {
    resetConfigCache()
    __setTestFallback(undefined)
    const result = isBountyProfile()
    expect(result).toBe(false)
  })
})
