import { describe, it, expect, beforeEach } from 'vitest'
import { detectPlatform, checkDockerAvailable, getPlatformCapabilities, getDefaultConfig, resetPlatformCache } from '../../src/execution/platform'

describe('detectPlatform', () => {
  beforeEach(() => {
    resetPlatformCache()
  })

  it('detects a platform (result is one of the valid values)', async () => {
    const platform = await detectPlatform()
    expect(['linux-native', 'docker-desktop', 'no-docker']).toContain(platform)
  })

  it('caches platform detection', async () => {
    const p1 = await detectPlatform()
    const p2 = await detectPlatform()
    expect(p1).toBe(p2)
  })

  it('resets cache', async () => {
    const p1 = await detectPlatform()
    resetPlatformCache()
    const p2 = await detectPlatform()
    // After reset, it re-detects (same or different result is fine)
    expect(['linux-native', 'docker-desktop', 'no-docker']).toContain(p2)
  })
})

describe('checkDockerAvailable', () => {
  it('returns a boolean', async () => {
    const available = await checkDockerAvailable()
    expect(typeof available).toBe('boolean')
  })
})

describe('getPlatformCapabilities', () => {
  it('linux-native has full capabilities', () => {
    const caps = getPlatformCapabilities('linux-native')
    expect(caps.netRaw).toBe(true)
    expect(caps.netAdmin).toBe(true)
    expect(caps.hostNetwork).toBe(true)
    expect(caps.procAccess).toBe(true)
    expect(caps.warning).toBeUndefined()
  })

  it('docker-desktop has limited capabilities with warning', () => {
    const caps = getPlatformCapabilities('docker-desktop')
    expect(caps.netRaw).toBe(false)
    expect(caps.netAdmin).toBe(false)
    expect(caps.hostNetwork).toBe(false)
    expect(caps.warning).toBeDefined()
  })

  it('no-docker has no capabilities with warning', () => {
    const caps = getPlatformCapabilities('no-docker')
    expect(caps.netRaw).toBe(false)
    expect(caps.warning).toContain('Docker not available')
  })
})

describe('getDefaultConfig', () => {
  it('returns valid config for each platform', () => {
    for (const platform of ['linux-native', 'docker-desktop', 'no-docker'] as const) {
      const config = getDefaultConfig(platform)
      expect(config.image).toBeTruthy()
      expect(config.timeoutMs).toBeGreaterThan(0)
      expect(config.memoryLimit).toBeTruthy()
      expect(config.cpuQuota).toBeGreaterThan(0)
    }
  })

  it('linux-native uses host network', () => {
    const config = getDefaultConfig('linux-native')
    expect(config.networkMode).toBe('host')
  })

  it('docker-desktop uses bridge network', () => {
    const config = getDefaultConfig('docker-desktop')
    expect(config.networkMode).toBe('bridge')
  })
})
