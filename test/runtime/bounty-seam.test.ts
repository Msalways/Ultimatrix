import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEngagementRuntime } from '../../src/runtime/engagement-runtime'
import { isBountyProfile } from '../../src/safety/bounty-policy'
import { resetConfigCache, loadConfig } from '../../src/config'
import type { UltimatrixConfig } from '../../src/config'

/**
 * End-to-end proof that the live bounty profile survives the engagement seam.
 *
 * Reproduces the exact `--bounty` CLI path: `loadConfig()` returns a local object
 * that the CLI mutates and hands to the runtime. Gates that consulted the
 * process-global config cache would not see that mutation.
 */
async function bountyConfig(target: string): Promise<UltimatrixConfig> {
  const base = loadConfig({ requireCredentials: false }) as UltimatrixConfig
  base.target = target
  base.authorization = {
    confirmed: true,
    method: 'bounty',
    target: new URL(target).origin,
    timestamp: '2026-09-26T00:00:00.000Z',
  }
  base.bounty = { enabled: true, allowedCategories: ['read', 'browser_action'] }
  base.scope = {
    allowedDomains: [new URL(target).hostname],
    allowedOrigins: [new URL(target).origin],
    allowedPorts: [Number(new URL(target).port || 443)],
    enforcement: 'hard',
    allowedCategories: ['read', 'browser_action'],
  }
  base.budgetPolicy = { ...(base.budgetPolicy as any), enforcement: 'hard' }
  base.externalTools = { enabled: false, tools: {} }
  return base
}

describe('bounty profile engagement seam', () => {
  it('is visible to tool gates inside the engagement, not just the preflight', async () => {
    resetConfigCache()
    const outputDir = await mkdtemp(join(tmpdir(), 'ultimatrix-bounty-seam-'))
    const target = 'https://seam.example/app'
    const config = await bountyConfig(target)

    // The process-global config has NO bounty block: this is what every tool
    // would have observed had it consulted getConfig() instead of the container.
    expect(loadConfig({ requireCredentials: false }).bounty?.enabled).not.toBe(true)

    const runtime = await createEngagementRuntime(config, target, { outputDir })
    try {
      const observed = await runtime.run(async () => isBountyProfile())
      expect(observed).toBe(true)

      // And the engagement container itself is the single source of truth.
      expect(runtime.services.bountyEnabled).toBe(true)
    } finally {
      await runtime.dispose()
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('reports the profile as inactive for an ordinary engagement', async () => {
    resetConfigCache()
    const outputDir = await mkdtemp(join(tmpdir(), 'ultimatrix-nonbounty-seam-'))
    const target = 'https://ordinary.example/app'
    const config = loadConfig({ requireCredentials: false }) as UltimatrixConfig
    config.target = target

    const runtime = await createEngagementRuntime(config, target, { outputDir })
    try {
      const observed = await runtime.run(async () => isBountyProfile())
      expect(observed).toBe(false)
      expect(runtime.services.bountyEnabled).toBe(false)
    } finally {
      await runtime.dispose()
      await rm(outputDir, { recursive: true, force: true })
    }
  })
})
