import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/browser/dialog-watcher', () => ({
  getGlobalDialogWatcher: () => ({
    getDialogs: () => [],
    readInterceptedDialogs: async () => [],
  }),
}))

vi.mock('../../src/browser/reaction-observer', () => ({
  getGlobalReactionObserver: () => ({
    captureBaseline: vi.fn().mockResolvedValue(undefined),
    detectReaction: vi.fn().mockResolvedValue({
      reactions: [],
      hasChanges: false,
      summary: '',
      baseline: null,
      current: null,
    }),
  }),
}))

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({}),
}))

vi.mock('../../src/tools/control-tools', () => ({
  recordBrowserEffectEvidence: vi.fn((input: any) => ({
    id: `evidence-${input.correlationToken ?? 'none'}`,
    ...input,
  })),
}))

vi.mock('../../src/safety/scope-guard', () => ({
  isUrlInScope: (url: string) => url.startsWith('https://target.test/')
    ? { allowed: true }
    : { allowed: false, reason: 'out of scope' },
  enforceAction: vi.fn(),
}))

vi.mock('../../src/browser/anti-bot', () => ({
  getGlobalBotHandler: () => ({
    detectChallenge: vi.fn().mockResolvedValue({ detected: false }),
    waitForResolution: vi.fn(),
  }),
}))

vi.mock('../../src/capture/render-bridge', () => ({
  wireRenderTrace: vi.fn(),
}))

vi.mock('../../src/capture/human-observer', () => ({
  getGlobalObserver: () => ({ record: vi.fn() }),
}))

vi.mock('../../src/browser/manager', () => ({
  getActivePage: () => undefined,
}))

vi.mock('../../src/browser/provider', () => ({
  isCamofoxHandle: (browser: any) => browser?.providerName === 'camofox',
}))

vi.mock('../../src/utils/logger', () => ({
  log: { dim: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { wrapStagehandTools } from '../../src/browser/dialog-inject'
import { recordBrowserEffectEvidence } from '../../src/tools/control-tools'

function makeBrowser() {
  const page = {
    url: vi.fn().mockReturnValue('https://target.test/start'),
    title: vi.fn().mockResolvedValue('Start'),
    evaluate: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(''),
  }
  const navigate = vi.fn().mockResolvedValue({ success: true, value: 'ok' })
  const act = vi.fn().mockResolvedValue({ success: true })
  const browser: any = {
    providerName: 'camofox',
    page,
    getTools: () => ({
      stagehand_navigate: { execute: navigate },
      stagehand_act: { execute: act },
    }),
  }
  return { browser, page, navigate, act }
}

describe('browser action wrapper', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves the provider page when Mastra context contains only agent metadata', async () => {
    const { browser, page, navigate } = makeBrowser()
    const wrapped = wrapStagehandTools(browser)

    const result = await wrapped.stagehand_navigate.execute(
      { url: 'https://target.test/next' },
      { agent: { threadId: 'thread-1' } },
    )

    expect(navigate).toHaveBeenCalledWith(
      { url: 'https://target.test/next' },
      expect.objectContaining({ page }),
    )
    expect(result.success).toBe(true)
    expect(result.browserAction).toMatchObject({ pageUrl: 'https://target.test/start' })
    expect(result.browserAction.evidenceIds.length).toBeGreaterThan(0)
    expect(recordBrowserEffectEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ correlationToken: result.browserAction.correlationToken }),
    )
  })

  it('enforces scope before invoking a provider action', async () => {
    const { browser, navigate } = makeBrowser()
    const wrapped = wrapStagehandTools(browser)

    const result = await wrapped.stagehand_navigate.execute(
      { url: 'https://outside.test/next' },
      { agent: { threadId: 'thread-1' } },
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Scope violation')
    expect(navigate).not.toHaveBeenCalled()
  })
})
