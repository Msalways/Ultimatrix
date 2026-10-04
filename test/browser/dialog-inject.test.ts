import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  flushCapturedRequests: vi.fn(),
  acquireTargetRequest: vi.fn(),
}))

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

vi.mock('../../src/runtime/engagement-context', () => ({
  getEngagementServices: () => ({ passiveObserver: { flushCapturedRequests: h.flushCapturedRequests } }),
}))

vi.mock('../../src/runtime/target-governor', () => ({
  getTargetTransportGovernor: () => ({ acquire: h.acquireTargetRequest }),
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
import { getGlobalReactionObserver } from '../../src/browser/reaction-observer'

function makeBrowser() {
  const page: any = {
    url: vi.fn().mockReturnValue('https://target.test/start'),
    title: vi.fn().mockResolvedValue('Start'),
    evaluate: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(''),
  }
  const navigate = vi.fn().mockResolvedValue({ success: true, value: 'ok' })
  const act = vi.fn().mockResolvedValue({ success: true })
  const observe = vi.fn().mockResolvedValue({ success: true, actions: [] })
  const extract = vi.fn().mockResolvedValue({ success: true, data: {} })
  const browser: any = {
    providerName: 'camofox',
    page,
    getTools: () => ({
      stagehand_navigate: { execute: navigate },
      stagehand_act: { execute: act },
      stagehand_observe: { execute: observe },
      stagehand_extract: { execute: extract },
    }),
  }
  return { browser, page, navigate, act, observe, extract }
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

  it('flushes completed browser traffic into the shared request store after an action', async () => {
    const { browser, act } = makeBrowser()
    const wrapped = wrapStagehandTools(browser)

    await wrapped.stagehand_act.execute(
      { instruction: 'Use the visible search field' },
      { agent: { threadId: 'thread-1' } },
    )

    expect(act).toHaveBeenCalledOnce()
    expect(h.flushCapturedRequests).toHaveBeenCalledOnce()
    expect(h.acquireTargetRequest).not.toHaveBeenCalled()
  })

  it('uses a live DOM inventory for observe instead of a secondary Stagehand model call', async () => {
    const { browser, page, observe } = makeBrowser()
    page.evaluate.mockResolvedValue({
      title: 'Juice Shop',
      text: 'Search products',
      textLength: 14,
      controls: [{
        tag: 'input', role: 'searchbox', name: 'Search', type: 'search', placeholder: 'Search',
        locators: [{ kind: 'placeholder', value: 'Search' }],
      }],
      links: [],
    })
    const wrapped = wrapStagehandTools(browser)

    const result = await wrapped.stagehand_observe.execute({}, { agent: { threadId: 'thread-1' } })

    expect(result).toMatchObject({ success: true, source: 'live-dom', title: 'Juice Shop' })
    expect(result.controls[0].locators[0]).toMatchObject({ kind: 'placeholder', value: 'Search' })
    const pageExpression = page.evaluate.mock.calls[0][0]
    expect(typeof pageExpression).toBe('string')
    expect(pageExpression).toContain('document.querySelectorAll')
    expect(pageExpression).not.toContain('__name')
    expect(getGlobalReactionObserver().captureBaseline).not.toHaveBeenCalled()
    expect(getGlobalReactionObserver().detectReaction).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
  })

  it('requires an observed unique visible control before deterministic fill actions', async () => {
    const { browser, page } = makeBrowser()
    const target = {
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
      fill: vi.fn().mockResolvedValue(undefined),
    }
    page.getByPlaceholder = vi.fn().mockReturnValue(target)
    page.evaluate.mockResolvedValue({
      title: 'Juice Shop', text: 'Search products', textLength: 14, links: [],
      controls: [{
        tag: 'input', role: 'searchbox', name: 'Search', type: 'search', placeholder: 'Search',
        locators: [{ kind: 'placeholder', value: 'Search' }],
      }],
    })
    const wrapped = wrapStagehandTools(browser)
    const context = { agent: { threadId: 'thread-1' } }

    const blocked = await wrapped.browserInteract.execute({
      action: 'fill', locator: { kind: 'placeholder', value: 'Search' }, value: 'apple',
    }, context)
    expect(blocked.success).toBe(false)
    expect(target.fill).not.toHaveBeenCalled()

    await wrapped.stagehand_observe.execute({}, context)
    const result = await wrapped.browserInteract.execute({
      action: 'fill', locator: { kind: 'placeholder', value: 'Search' }, value: 'apple',
    }, context)

    expect(result).toMatchObject({ success: true, action: 'fill', valueLength: 5 })
    expect(target.fill).toHaveBeenCalledWith('apple', { timeout: 5000 })
    // The initial rejected interaction also flushes in case a provider action
    // had partially completed before reporting failure.
    expect(h.flushCapturedRequests).toHaveBeenCalledTimes(3)
  })

  it('uses observed CSS locators with Stagehand v3 instead of unavailable getBy helpers', async () => {
    const { browser, page } = makeBrowser()
    const target = {
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
      fill: vi.fn().mockResolvedValue(undefined),
    }
    page.locator = vi.fn().mockReturnValue(target)
    page.evaluate.mockResolvedValue({
      title: 'Juice Shop', text: 'Search products', textLength: 14, links: [],
      controls: [{
        tag: 'input', role: 'textbox', name: 'Search', type: 'text',
        locators: [
          { kind: 'role', role: 'textbox', value: 'Search' },
          { kind: 'css', value: 'html > body > app-root > input:nth-of-type(1)' },
        ],
      }],
    })
    const wrapped = wrapStagehandTools(browser)
    const context = { page }
    await wrapped.stagehand_observe.execute({}, context)
    const result = await wrapped.browserInteract.execute({
      action: 'fill', locator: { kind: 'role', role: 'textbox', value: 'Search' }, value: 'apple',
    }, context)

    expect(result).toMatchObject({ success: true, action: 'fill', valueLength: 5 })
    expect(page.locator).toHaveBeenCalledWith('html > body > app-root > input:nth-of-type(1)')
    expect(target.fill).toHaveBeenCalledWith('apple', { timeout: 5000 })
  })

  it('presses observed keys through the Stagehand CDP session when locators lack press()', async () => {
    const { browser, page } = makeBrowser()
    const target = {
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
      click: vi.fn().mockResolvedValue(undefined),
    }
    page.locator = vi.fn().mockReturnValue(target)
    page.mainSession = { send: vi.fn().mockResolvedValue(undefined) }
    page.evaluate.mockResolvedValue({
      title: 'Juice Shop', text: 'Search products', textLength: 14, links: [],
      controls: [{
        tag: 'input', role: 'textbox', name: 'Search', type: 'text',
        locators: [
          { kind: 'role', role: 'textbox', value: 'Search' },
          { kind: 'css', value: '#search' },
        ],
      }],
    })
    const wrapped = wrapStagehandTools(browser)
    const context = { page }
    await wrapped.stagehand_observe.execute({}, context)
    const result = await wrapped.browserInteract.execute({
      action: 'press', locator: { kind: 'role', role: 'textbox', value: 'Search' }, value: 'Enter',
    }, context)

    expect(result).toMatchObject({ success: true, action: 'press', key: 'Enter' })
    expect(target.click).toHaveBeenCalledOnce()
    expect(page.mainSession.send).toHaveBeenNthCalledWith(1, 'Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyDown', key: 'Enter' }))
    expect(page.mainSession.send).toHaveBeenNthCalledWith(2, 'Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'Enter' }))
  })

  it('rejects ambiguous controls instead of choosing the first match', async () => {
    const { browser, page } = makeBrowser()
    const target = { count: vi.fn().mockResolvedValue(2), isVisible: vi.fn(), click: vi.fn() }
    page.getByRole = vi.fn().mockReturnValue(target)
    page.evaluate.mockResolvedValue({
      title: 'Juice Shop', text: '', textLength: 0, links: [],
      controls: [{
        tag: 'button', role: 'button', name: 'Search',
        locators: [{ kind: 'role', role: 'button', value: 'Search' }],
      }],
    })
    const wrapped = wrapStagehandTools(browser)
    const context = { agent: { threadId: 'thread-1' } }
    await wrapped.stagehand_observe.execute({}, context)
    const result = await wrapped.browserInteract.execute({
      action: 'click', locator: { kind: 'role', role: 'button', value: 'Search' },
    }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('exactly one')
    expect(target.click).not.toHaveBeenCalled()
  })
})
