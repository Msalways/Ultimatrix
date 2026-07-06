import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectReactions, getDialogEvidence, getRecentChanges } from '../../src/tools/reaction-tools'
import { getGlobalReactionObserver } from '../../src/browser/reaction-observer'
import { getGlobalDialogWatcher } from '../../src/browser/dialog-watcher'

vi.mock('../../src/browser/reaction-observer', () => ({
  getGlobalReactionObserver: vi.fn(),
}))

vi.mock('../../src/browser/dialog-watcher', () => ({
  getGlobalDialogWatcher: vi.fn(),
}))

describe('detectReactions tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no reactions when observer is empty', async () => {
    const mockObserver = {
      getRecentReactions: vi.fn(() => []),
      getReactionSummary: vi.fn(() => ''),
    }
    vi.mocked(getGlobalReactionObserver).mockReturnValue(mockObserver as any)

    const result = await detectReactions.execute({ sinceSeconds: 10 }, { toolCallId: 'test', messages: [], threadId: 'test', resourceId: 'test' })
    expect(result.ok).toBe(true)
    expect(result.value.reactionCount).toBe(0)
  })

  it('returns reactions when observer has data', async () => {
    const mockObserver = {
      getRecentReactions: vi.fn(() => [
        { type: 'modal', content: 'Dialog appeared', visible: true, timestamp: Date.now() },
      ]),
      getReactionSummary: vi.fn(() => '[modal] Dialog appeared'),
    }
    vi.mocked(getGlobalReactionObserver).mockReturnValue(mockObserver as any)

    const result = await detectReactions.execute({ sinceSeconds: 10 }, { toolCallId: 'test', messages: [], threadId: 'test', resourceId: 'test' })
    expect(result.ok).toBe(true)
    expect(result.value.reactionCount).toBe(1)
    expect(result.value.summary).toContain('modal')
  })
})

describe('getDialogEvidence tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no dialogs when watcher is empty', async () => {
    const mockWatcher = {
      getDialogs: vi.fn(() => []),
      getRecentDialogs: vi.fn(() => []),
      hasXSSEvidence: vi.fn(() => false),
      getDialogSummary: vi.fn(() => ''),
    }
    vi.mocked(getGlobalDialogWatcher).mockReturnValue(mockWatcher as any)

    const result = await getDialogEvidence.execute({}, { toolCallId: 'test', messages: [], threadId: 'test', resourceId: 'test' })
    expect(result.ok).toBe(true)
    expect(result.value.dialogCount).toBe(0)
    expect(result.value.hasXSS).toBe(false)
  })

  it('detects XSS evidence in dialogs', async () => {
    const mockWatcher = {
      getDialogs: vi.fn(() => [
        { type: 'alert', message: 'XSS', url: 'https://example.com', timestamp: Date.now() },
      ]),
      getRecentDialogs: vi.fn(() => [
        { type: 'alert', message: 'XSS', url: 'https://example.com', timestamp: Date.now() },
      ]),
      hasXSSEvidence: vi.fn(() => true),
      getDialogSummary: vi.fn(() => '[alert] XSS at https://example.com'),
    }
    vi.mocked(getGlobalDialogWatcher).mockReturnValue(mockWatcher as any)

    const result = await getDialogEvidence.execute({}, { toolCallId: 'test', messages: [], threadId: 'test', resourceId: 'test' })
    expect(result.ok).toBe(true)
    expect(result.value.dialogCount).toBe(1)
    expect(result.value.hasXSS).toBe(true)
  })
})

describe('getRecentChanges tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no changes when nothing happened', async () => {
    const mockObserver = {
      getRecentReactions: vi.fn(() => []),
    }
    const mockWatcher = {
      getRecentDialogs: vi.fn(() => []),
    }
    vi.mocked(getGlobalReactionObserver).mockReturnValue(mockObserver as any)
    vi.mocked(getGlobalDialogWatcher).mockReturnValue(mockWatcher as any)

    const result = await getRecentChanges.execute({}, { toolCallId: 'test', messages: [], threadId: 'test', resourceId: 'test' })
    expect(result.ok).toBe(true)
    expect(result.value.hasChanges).toBe(false)
  })

  it('reports errors and toasts', async () => {
    const mockObserver = {
      getRecentReactions: vi.fn(() => [
        { type: 'error', content: 'Login failed', visible: true, timestamp: Date.now() },
        { type: 'toast', content: 'Saved', visible: true, timestamp: Date.now() },
      ]),
    }
    const mockWatcher = {
      getRecentDialogs: vi.fn(() => []),
    }
    vi.mocked(getGlobalReactionObserver).mockReturnValue(mockObserver as any)
    vi.mocked(getGlobalDialogWatcher).mockReturnValue(mockWatcher as any)

    const result = await getRecentChanges.execute({}, { toolCallId: 'test', messages: [], threadId: 'test', resourceId: 'test' })
    expect(result.ok).toBe(true)
    expect(result.value.hasChanges).toBe(true)
    expect(result.value.summary).toContain('Login failed')
    expect(result.value.summary).toContain('Saved')
  })
})
