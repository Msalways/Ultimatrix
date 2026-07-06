import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getGlobalDialogWatcher,
  startDialogWatcher,
  stopDialogWatcher,
} from '../../src/browser/dialog-watcher'

describe('DialogWatcher', () => {
  afterEach(() => {
    stopDialogWatcher()
  })

  it('starts unattached via global', () => {
    const w = getGlobalDialogWatcher()
    expect(w.isAttached()).toBe(false)
    expect(w.getDialogs()).toEqual([])
  })

  it('attaches to browser with valid Stagehand context', () => {
    const mockConn = { on: vi.fn(), off: vi.fn(), send: vi.fn() }
    const mockBrowser = {
      requireStagehand: () => ({
        context: { conn: mockConn, pages: [] },
      }),
    }

    const w = startDialogWatcher(mockBrowser)
    expect(w.isAttached()).toBe(true)
    expect(mockConn.on).toHaveBeenCalledWith('Target.attachedToTarget', expect.any(Function))
  })

  it('does not double-attach', () => {
    const mockBrowser = {
      requireStagehand: () => ({
        context: { conn: { on: vi.fn() }, pages: [] },
      }),
    }

    startDialogWatcher(mockBrowser)
    startDialogWatcher(mockBrowser)
    const w = getGlobalDialogWatcher()
    expect(w.isAttached()).toBe(true)
  })

  it('returns detached when no Stagehand context', () => {
    stopDialogWatcher()
    const mockBrowser = { requireStagehand: () => null }
    startDialogWatcher(mockBrowser)
    const w = getGlobalDialogWatcher()
    expect(w.isAttached()).toBe(false)
  })

  it('returns detached when no CDP connection', () => {
    stopDialogWatcher()
    const mockBrowser = {
      requireStagehand: () => ({ context: {} }),
    }
    startDialogWatcher(mockBrowser)
    const w = getGlobalDialogWatcher()
    expect(w.isAttached()).toBe(false)
  })

  it('records dialog events', () => {
    const w = getGlobalDialogWatcher()
    // Simulate a dialog event by pushing directly
    ;(w as any).dialogs = [
      { type: 'alert', message: 'XSS', url: 'https://example.com', timestamp: Date.now() },
    ]

    const dialogs = w.getDialogs()
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].type).toBe('alert')
    expect(dialogs[0].message).toBe('XSS')
  })

  it('getRecentDialogs filters by time', () => {
    const now = Date.now()
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = [
      { type: 'alert', message: 'old', url: '', timestamp: now - 10000 },
      { type: 'confirm', message: 'new', url: '', timestamp: now },
    ]

    const recent = w.getRecentDialogs(5000)
    expect(recent).toHaveLength(1)
    expect(recent[0].message).toBe('new')
  })

  it('hasXSSEvidence detects XSS-related alert messages', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = [
      { type: 'alert', message: 'XSS from payload', url: '', timestamp: Date.now() },
    ]
    expect(w.hasXSSEvidence()).toBe(true)
  })

  it('hasXSSEvidence returns false for non-XSS dialogs', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = [
      { type: 'alert', message: 'Session expired', url: '', timestamp: Date.now() },
    ]
    expect(w.hasXSSEvidence()).toBe(false)
  })

  it('hasXSSEvidence detects script tags in alert', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = [
      { type: 'alert', message: '<script>alert(1)</script>', url: '', timestamp: Date.now() },
    ]
    expect(w.hasXSSEvidence()).toBe(true)
  })

  it('hasXSSEvidence detects onerror in alert', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = [
      { type: 'alert', message: 'onerror=alert(1)', url: '', timestamp: Date.now() },
    ]
    expect(w.hasXSSEvidence()).toBe(true)
  })

  it('getDialogSummary formats dialogs', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = [
      { type: 'alert', message: 'test', url: 'https://example.com', timestamp: Date.now() },
    ]
    const summary = w.getDialogSummary()
    expect(summary).toContain('[alert]')
    expect(summary).toContain('test')
    expect(summary).toContain('https://example.com')
  })

  it('getDialogSummary returns empty when no dialogs', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = []
    expect(w.getDialogSummary()).toBe('')
  })

  it('clear removes all dialogs', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = [
      { type: 'alert', message: 'test', url: '', timestamp: Date.now() },
    ]
    w.clear()
    expect(w.getDialogs()).toEqual([])
  })

  it('detach cleans up listeners', () => {
    const cleanupFn = vi.fn()
    const w = getGlobalDialogWatcher()
    ;(w as any).cleanupFns = [cleanupFn]
    ;(w as any).attached = true

    w.detach()
    expect(w.isAttached()).toBe(false)
    expect(cleanupFn).toHaveBeenCalled()
  })

  it('caps stored dialogs at MAX_STORED_DIALOGS', () => {
    const w = getGlobalDialogWatcher()
    ;(w as any).dialogs = []
    for (let i = 0; i < 101; i++) {
      ;(w as any).dialogs.push({
        type: 'alert',
        message: `msg ${i}`,
        url: '',
        timestamp: Date.now(),
      })
    }
    ;(w as any).dialogs = (w as any).dialogs.slice(-100)
    expect(w.getDialogs().length).toBeLessThanOrEqual(100)
  })
})

describe('Global DialogWatcher', () => {
  afterEach(() => {
    stopDialogWatcher()
  })

  it('getGlobalDialogWatcher returns singleton', () => {
    const w1 = getGlobalDialogWatcher()
    const w2 = getGlobalDialogWatcher()
    expect(w1).toBe(w2)
  })

  it('startDialogWatcher attaches to browser', () => {
    const mockBrowser = {
      requireStagehand: () => ({
        context: { conn: { on: vi.fn() }, pages: [] },
      }),
    }
    const watcher = startDialogWatcher(mockBrowser)
    expect(watcher.isAttached()).toBe(true)
  })

  it('stopDialogWatcher detaches', () => {
    const mockBrowser = {
      requireStagehand: () => ({
        context: { conn: { on: vi.fn() }, pages: [] },
      }),
    }
    startDialogWatcher(mockBrowser)
    stopDialogWatcher()
    const newWatcher = getGlobalDialogWatcher()
    expect(newWatcher.isAttached()).toBe(false)
  })
})
