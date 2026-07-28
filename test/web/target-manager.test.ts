import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('TargetManager', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/web/target-manager')
    expect(mod.TargetManager).toBeDefined()
    expect(typeof mod.TargetManager).toBe('function')
  })

  it('TargetManager has expected methods', async () => {
    const { TargetManager } = await import('../../src/web/target-manager')
    const tm = new TargetManager()
    expect(typeof tm.getOrCreateEngine).toBe('function')
    expect(typeof tm.getEngine).toBe('function')
    expect(typeof tm.listTargets).toBe('function')
  })
})
