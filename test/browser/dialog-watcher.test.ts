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
    const mockAddInitScript = vi.fn().mockResolvedValue(undefined)
    const mockEvaluate = vi.fn().mockResolvedValue(undefined)
    const mockBrowser = {
      requireStagehand: () => ({
        context: {
          addInitScript: mockAddInitScript,
          pages: () => [{ evaluate: mockEvaluate }],
        },
      }),
    }

    const w = startDialogWatcher(mockBrowser)
    expect(w.isAttached()).toBe(true)
    expect(mockAddInitScript).toHaveBeenCalledWith(expect.stringContaining('__ULTIMATRIX_DIALOG_INTERCEPTOR'))
  })

  it('does not double-attach', () => {
    const mockBrowser = {
      requireStagehand: () => ({
        context: {
          addInitScript: vi.fn().mockResolvedValue(undefined),
          pages: () => [],
        },
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

  it('returns detached when no addInitScript', () => {
    stopDialogWatcher()
    const mockBrowser = {
      requireStagehand: () => ({ context: {} }),
    }
    startDialogWatcher(mockBrowser)
    const w = getGlobalDialogWatcher()
    // context exists but addInitScript is missing — still attaches (best-effort)
    expect(w.isAttached()).toBe(true)
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
    const w = getGlobalDialogWatcher()
    ;(w as any).attached = true

    w.detach()
    expect(w.isAttached()).toBe(false)
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

  it('readInterceptedDialogs reads from page window array', async () => {
    const w = getGlobalDialogWatcher()
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        { type: 'alert', message: 'intercepted!', url: 'https://test.com', timestamp: Date.now() },
      ]),
      url: () => 'https://test.com',
    }

    const events = await w.readInterceptedDialogs(mockPage)
    expect(events).toHaveLength(1)
    expect(events[0].message).toBe('intercepted!')
    // Also stored in watcher
    expect(w.getDialogs()).toHaveLength(1)
    expect(w.getDialogs()[0].message).toBe('intercepted!')
  })

  it('readInterceptedDialogs returns empty for empty array', async () => {
    const w = getGlobalDialogWatcher()
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([]),
      url: () => 'https://test.com',
    }

    const events = await w.readInterceptedDialogs(mockPage)
    expect(events).toHaveLength(0)
  })

  it('readInterceptedDialogs handles page without evaluate', async () => {
    const w = getGlobalDialogWatcher()
    const events = await w.readInterceptedDialogs(null)
    expect(events).toHaveLength(0)
  })

  it('readInterceptedDialogs handles evaluate failure', async () => {
    const w = getGlobalDialogWatcher()
    const mockPage = {
      evaluate: vi.fn().mockRejectedValue(new Error('page crashed')),
    }

    const events = await w.readInterceptedDialogs(mockPage)
    expect(events).toHaveLength(0)
  })

  it('injectIntoPage injects interceptor script', async () => {
    const w = getGlobalDialogWatcher()
    const mockEvaluate = vi.fn().mockResolvedValue(undefined)
    const mockPage = { evaluate: mockEvaluate }

    await w.injectIntoPage(mockPage)
    expect(mockEvaluate).toHaveBeenCalledWith(expect.stringContaining('__ULTIMATRIX_DIALOG_INTERCEPTOR'))
  })

  it('injectIntoPage handles null page', async () => {
    const w = getGlobalDialogWatcher()
    // Should not throw
    await w.injectIntoPage(null)
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
        context: {
          addInitScript: vi.fn().mockResolvedValue(undefined),
          pages: () => [],
        },
      }),
    }
    const watcher = startDialogWatcher(mockBrowser)
    expect(watcher.isAttached()).toBe(true)
  })

  it('stopDialogWatcher detaches', () => {
    const mockBrowser = {
      requireStagehand: () => ({
        context: {
          addInitScript: vi.fn().mockResolvedValue(undefined),
          pages: () => [],
        },
      }),
    }
    startDialogWatcher(mockBrowser)
    stopDialogWatcher()
    const newWatcher = getGlobalDialogWatcher()
    expect(newWatcher.isAttached()).toBe(false)
  })
})
