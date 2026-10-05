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

  it('does not load model/runtime configuration for read-only target listing', async () => {
    vi.resetModules()
    vi.doMock('../../src/web/engine', () => { throw new Error('engine should load only when a target starts') })
    try {
      const { TargetManager } = await import('../../src/web/target-manager')
      const manager = new TargetManager()
      await expect(manager.listTargets()).resolves.toEqual([])
    } finally {
      vi.doUnmock('../../src/web/engine')
      vi.resetModules()
    }
  })

  it('serves an empty findings response without importing the model runtime', async () => {
    vi.resetModules()
    vi.doMock('../../src/web/engine', () => { throw new Error('read-only findings must not initialize the model runtime') })
    try {
      const [{ GET }, { NextRequest }] = await Promise.all([
        import('../../src/app/api/findings/route'),
        import('next/server'),
      ])
      const response = await GET(new NextRequest('http://localhost/api/findings'))
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ findings: [] })
    } finally {
      vi.doUnmock('../../src/web/engine')
      vi.resetModules()
    }
  })

  it('shares one startup when concurrent requests target the same engine', async () => {
    vi.resetModules()
    let releaseInit!: () => void
    const initGate = new Promise<void>(resolve => { releaseInit = resolve })
    let instanceCount = 0
    vi.doMock('../../src/web/engine', () => ({
      WebEngine: class {
        id = `engine-${++instanceCount}`
        init() { return initGate }
      },
    }))
    try {
      const { TargetManager } = await import('../../src/web/target-manager')
      const manager = new TargetManager()
      const first = manager.getOrCreateEngine('https://example.test')
      const second = manager.getOrCreateEngine('https://example.test')
      releaseInit()
      const [firstEngine, secondEngine] = await Promise.all([first, second])

      expect(firstEngine).toBe(secondEngine)
      expect(instanceCount).toBe(1)
    } finally {
      vi.doUnmock('../../src/web/engine')
      vi.resetModules()
    }
  })
})
