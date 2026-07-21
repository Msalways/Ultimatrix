import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getGlobalReactionObserver,
  resetGlobalReactionObserver,
} from '../../src/browser/reaction-observer'

vi.mock('../../src/browser/manager', () => ({
  getActivePage: vi.fn(),
}))

vi.mock('../../src/browser/dialog-watcher', () => ({
  getGlobalDialogWatcher: vi.fn(() => ({
    getDialogs: vi.fn(() => []),
    getRecentDialogs: vi.fn(() => []),
    hasXSSEvidence: vi.fn(() => false),
    getDialogSummary: vi.fn(() => ''),
  })),
}))

describe('ReactionObserver', () => {
  beforeEach(() => {
    resetGlobalReactionObserver()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetGlobalReactionObserver()
  })

  it('starts with no baseline', () => {
    const observer = getGlobalReactionObserver()
    expect(observer.isObserving()).toBe(false)
    expect(observer.getReactions()).toEqual([])
  })

  it('captureBaseline returns null when no page', async () => {
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(null)

    const observer = getGlobalReactionObserver()
    const baseline = await observer.captureBaseline()
    expect(baseline).toBeNull()
  })

  it('captureBaseline captures accessibility tree via snapshot()', async () => {
    const mockPage = {
      snapshot: vi.fn().mockResolvedValue({
        formattedTree: 'root\n  heading "Hello World" [level=1]\n  button "Submit"',
        xpathMap: {},
        urlMap: {},
      }),
      url: () => 'https://example.com',
    }
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(mockPage as any)

    const observer = getGlobalReactionObserver()
    const baseline = await observer.captureBaseline()
    expect(baseline).not.toBeNull()
    expect(baseline!.axElements).toHaveLength(3) // root, heading, button
    expect(baseline!.axElements[1].role).toBe('heading')
    expect(baseline!.axElements[1].text).toBe('Hello World')
    expect(baseline!.axElements[2].role).toBe('button')
    expect(baseline!.axElements[2].text).toBe('Submit')
    expect(observer.isObserving()).toBe(true)
  })

  it('captureBaseline falls back to evaluate when snapshot() unavailable', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue('Page text content'),
      url: () => 'https://example.com',
    }
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(mockPage as any)

    const observer = getGlobalReactionObserver()
    const baseline = await observer.captureBaseline()
    expect(baseline).not.toBeNull()
    expect(baseline!.visibleText).toBe('Page text content')
    expect(baseline!.axElements).toHaveLength(0) // No accessibility tree from fallback
  })

  it('detectReaction returns empty when no baseline', async () => {
    const observer = getGlobalReactionObserver()
    const result = await observer.detectReaction()
    expect(result.hasChanges).toBe(false)
    expect(result.reactions).toEqual([])
  })

  it('detectReaction detects new modals from accessibility tree', async () => {
    const mockPage = {
      snapshot: vi.fn()
        .mockResolvedValueOnce({
          formattedTree: 'root\n  heading "Page"',
          xpathMap: {},
          urlMap: {},
        })
        .mockResolvedValueOnce({
          formattedTree: 'root\n  heading "Page"\n  dialog "Delete Confirmation"\n    button "OK"\n    button "Cancel"',
          xpathMap: {},
          urlMap: {},
        }),
      url: () => 'https://example.com',
    }
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(mockPage as any)

    const observer = getGlobalReactionObserver()
    await observer.captureBaseline()
    const result = await observer.detectReaction()

    expect(result.hasChanges).toBe(true)
    const modalReaction = result.reactions.find(r => r.type === 'modal')
    expect(modalReaction).toBeDefined()
    expect(modalReaction!.content).toContain('Delete Confirmation')
  })

  it('detectReaction detects new alerts from accessibility tree', async () => {
    const mockPage = {
      snapshot: vi.fn()
        .mockResolvedValueOnce({
          formattedTree: 'root\n  heading "Page"',
          xpathMap: {},
          urlMap: {},
        })
        .mockResolvedValueOnce({
          formattedTree: 'root\n  heading "Page"\n  alert "Error: invalid input"',
          xpathMap: {},
          urlMap: {},
        }),
      url: () => 'https://example.com',
    }
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(mockPage as any)

    const observer = getGlobalReactionObserver()
    await observer.captureBaseline()
    const result = await observer.detectReaction()

    expect(result.hasChanges).toBe(true)
    const errorReaction = result.reactions.find(r => r.type === 'error')
    expect(errorReaction).toBeDefined()
    expect(errorReaction!.content).toContain('Error: invalid input')
  })

  it('detectReaction detects success messages from accessibility tree', async () => {
    const mockPage = {
      snapshot: vi.fn()
        .mockResolvedValueOnce({
          formattedTree: 'root\n  heading "Page"',
          xpathMap: {},
          urlMap: {},
        })
        .mockResolvedValueOnce({
          formattedTree: 'root\n  heading "Page"\n  status "Item saved successfully"',
          xpathMap: {},
          urlMap: {},
        }),
      url: () => 'https://example.com',
    }
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(mockPage as any)

    const observer = getGlobalReactionObserver()
    await observer.captureBaseline()
    const result = await observer.detectReaction()

    expect(result.hasChanges).toBe(true)
    const successReaction = result.reactions.find(r => r.type === 'success')
    expect(successReaction).toBeDefined()
    expect(successReaction!.content).toContain('saved successfully')
  })

  it('detectReaction detects URL changes', async () => {
    const mockPage = {
      snapshot: vi.fn().mockResolvedValue({
        formattedTree: 'root',
        xpathMap: {},
        urlMap: {},
      }),
      url: vi.fn()
        .mockReturnValueOnce('https://example.com/page1')
        .mockReturnValueOnce('https://example.com/page2'),
    }
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(mockPage as any)

    const observer = getGlobalReactionObserver()
    await observer.captureBaseline()
    const result = await observer.detectReaction()

    expect(result.hasChanges).toBe(true)
    const navReaction = result.reactions.find(r => r.content.includes('navigated'))
    expect(navReaction).toBeDefined()
  })

  it('detectReaction returns no changes when DOM unchanged', async () => {
    const mockPage = {
      snapshot: vi.fn().mockResolvedValue({
        formattedTree: 'root\n  heading "Same content"',
        xpathMap: {},
        urlMap: {},
      }),
      url: () => 'https://example.com',
    }
    const { getActivePage } = await import('../../src/browser/manager')
    vi.mocked(getActivePage).mockReturnValue(mockPage as any)

    const observer = getGlobalReactionObserver()
    await observer.captureBaseline()
    const result = await observer.detectReaction()

    expect(result.hasChanges).toBe(false)
    expect(result.reactions).toEqual([])
  })

  it('getReactionSummary formats reactions', () => {
    const observer = getGlobalReactionObserver()
    ;(observer as any).reactions = [
      { type: 'error', content: 'Login failed', visible: true, timestamp: Date.now() },
      { type: 'toast', content: 'Saved', visible: true, timestamp: Date.now() },
    ]

    const summary = observer.getReactionSummary()
    expect(summary).toContain('[error]')
    expect(summary).toContain('Login failed')
    expect(summary).toContain('[toast]')
    expect(summary).toContain('Saved')
  })

  it('getReactionSummary returns empty when no reactions', () => {
    const observer = getGlobalReactionObserver()
    expect(observer.getReactionSummary()).toBe('')
  })

  it('getRecentReactions filters by time', () => {
    const now = Date.now()
    const observer = getGlobalReactionObserver()
    ;(observer as any).reactions = [
      { type: 'error', content: 'old', visible: true, timestamp: now - 20000 },
      { type: 'toast', content: 'new', visible: true, timestamp: now },
    ]

    const recent = observer.getRecentReactions(10000)
    expect(recent).toHaveLength(1)
    expect(recent[0].content).toBe('new')
  })

  it('clear resets everything', () => {
    const observer = getGlobalReactionObserver()
    ;(observer as any).reactions = [{ type: 'error', content: 'test', visible: true, timestamp: Date.now() }]
    ;(observer as any).baseline = { visibleText: 'test', axElements: [], dialogCount: 0, url: '', timestamp: Date.now() }
    ;(observer as any).observing = true

    observer.clear()
    expect(observer.getReactions()).toEqual([])
    expect(observer.isObserving()).toBe(false)
  })
})

describe('Global ReactionObserver', () => {
  afterEach(() => {
    resetGlobalReactionObserver()
  })

  it('getGlobalReactionObserver returns singleton', () => {
    const o1 = getGlobalReactionObserver()
    const o2 = getGlobalReactionObserver()
    expect(o1).toBe(o2)
  })

  it('resetGlobalReactionObserver creates fresh instance', () => {
    const o1 = getGlobalReactionObserver()
    resetGlobalReactionObserver()
    const o2 = getGlobalReactionObserver()
    expect(o1).not.toBe(o2)
  })
})
