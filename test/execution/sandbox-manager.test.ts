import { describe, it, expect, beforeEach } from 'vitest'
import { SandboxManager, getGlobalSandboxManager, resetGlobalSandboxManager } from '../../src/execution/sandbox-manager'

describe('SandboxManager', () => {
  let manager: SandboxManager

  beforeEach(() => {
    manager = new SandboxManager({ enabled: false })
  })

  it('initializes with no-docker platform', () => {
    const status = manager.getStatus()
    expect(status.platform).toBe('no-docker')
    expect(status.dockerAvailable).toBe(false)
    expect(status.containerRunning).toBe(false)
  })

  it('is not available before ensureReady', () => {
    expect(manager.isAvailable()).toBe(false)
  })

  it('returns error when executing without ready', async () => {
    const result = await manager.execute({
      toolId: 'nmap',
      args: ['nmap', '-sV', 'localhost'],
    })
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain('not available')
  })

  it('reports capabilities for current platform', () => {
    const caps = manager.getCapabilities()
    expect(caps).toBeDefined()
    expect(typeof caps.netRaw).toBe('boolean')
  })

  it('shutdown cleans up gracefully', async () => {
    await manager.shutdown()
    expect(manager.isAvailable()).toBe(false)
  })
})

describe('Global SandboxManager', () => {
  beforeEach(() => {
    resetGlobalSandboxManager()
  })

  it('creates singleton', () => {
    const m1 = getGlobalSandboxManager()
    const m2 = getGlobalSandboxManager()
    expect(m1).toBe(m2)
  })

  it('resets instance', () => {
    const m1 = getGlobalSandboxManager()
    resetGlobalSandboxManager()
    const m2 = getGlobalSandboxManager()
    expect(m1).not.toBe(m2)
  })
})
