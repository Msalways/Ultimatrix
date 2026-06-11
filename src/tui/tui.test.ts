import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('TUI backend', () => {
  it('createAnsiBackend returns a Backend with required methods', async () => {
    const { createAnsiBackend } = await import('./backend')
    const backend = createAnsiBackend()
    expect(backend).toBeDefined()
    expect(typeof backend.size).toBe('function')
    expect(typeof backend.draw).toBe('function')
    expect(typeof backend.flush).toBe('function')
    expect(typeof backend.hideCursor).toBe('function')
    expect(typeof backend.showCursor).toBe('function')
    expect(typeof backend.clear).toBe('function')
    expect(typeof backend.getCursorPosition).toBe('function')
    expect(typeof backend.setCursorPosition).toBe('function')
  })

  it('size returns valid dimensions', async () => {
    const { createAnsiBackend } = await import('./backend')
    const backend = createAnsiBackend()
    const size = backend.size()
    expect(size.width).toBeGreaterThanOrEqual(70)
    expect(size.height).toBeGreaterThanOrEqual(18)
  })

  it('clear and hideCursor are no-ops in test environment', async () => {
    const { createAnsiBackend } = await import('./backend')
    const backend = createAnsiBackend()
    expect(() => backend.clear()).not.toThrow()
    expect(() => backend.hideCursor()).not.toThrow()
    expect(() => backend.showCursor()).not.toThrow()
    expect(() => backend.flush()).not.toThrow()
  })

  it('getCursorPosition returns default position', async () => {
    const { createAnsiBackend } = await import('./backend')
    const backend = createAnsiBackend()
    const pos = backend.getCursorPosition()
    expect(pos).toHaveProperty('x', 0)
    expect(pos).toHaveProperty('y', 0)
  })
})

describe('TUI startTUI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('exports startTUI function', async () => {
    const mod = await import('./index')
    expect(mod.startTUI).toBeDefined()
    expect(typeof mod.startTUI).toBe('function')
  })
})
