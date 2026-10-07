/**
 * Phase C (spec 03) â€” honest frontier, stale accounting, endpoint hygiene.
 *
 * Locks: `frontier_exhausted` only when nothing actionable remains;
 * `agent_stopped` when the driver quits with work queued; text-only output
 * accrues stale rounds; baseline links become Endpoints ONLY when
 * param-bearing.
 */
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({
  streamFactory: null as null | (() => AsyncIterable<any>),
}))

vi.mock('../../src/spider/agent', () => ({
  createSpiderAgent: () => ({
    stream: async () => ({ fullStream: h.streamFactory?.() ?? (async function* () { })() }),
  }),
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn(), success: vi.fn() },
}))
vi.mock('../../src/tools/report-tools', () => ({
  getForensicLog: vi.fn().mockReturnValue({ log: vi.fn() }),
  setForensicLog: vi.fn(),
}))

import { SpiderRuntime } from '../../src/spider/runtime'
import type { SpiderRuntimeState } from '../../src/spider/runtime'
import { runSpiderRuntime } from '../../src/spider/runtime'
import { getTargetTransportGovernor } from '../../src/runtime/target-governor'
import { planCampaign } from '../../src/campaign/planner'

function config(overrides: Record<string, unknown> = {}) {
  return {
    spider: { maxPages: 50, maxDepth: 2, maxDurationMs: 30_000 },
    agent: { maxSteps: 40 },
    timeout: 5000,
    antiLoop: { staleThreshold: 3 },
    ...overrides,
  } as any
}

function fakeBrowserPage(links: string[], forms: any[] | ((url: string) => any[]) = []) {
  let currentUrl = 'https://example.com/'
  const page = {
    goto: vi.fn(async () => ({ status: () => 200 })),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => 'Home'),
    evaluate: vi.fn(async (extractor: Function) => {
      if (extractor.name === 'extractLinksInPage') return links
      if (extractor.name === 'extractFormsInPage') return typeof forms === 'function' ? forms(currentUrl) : forms
      return []
    }),
  }
  return {
    requireStagehand: () => ({ context: { activePage: () => page } }),
    setPageUrl: (url: string) => { currentUrl = url },
  }
}

describe('C1 â€” honest frontier', () => {
  it('dequeue pops allowed FIFO entries and skips proposed', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf1', target: 'https://example.com', config: config(), allowAny: false })
    runtime.enqueue('https://example.com/a', 1)
    runtime.enqueue('https://cdn.other.net/b', 1)   // proposed (external)
    runtime.enqueue('https://example.com/c', 2)

    const first = runtime.dequeue()
    expect(first?.url).toBe('https://example.com/a')
    const second = runtime.dequeue()
    expect(second?.url).toBe('https://example.com/c')
    expect(runtime.dequeue()).toBeNull()
  })

  it('countActionable respects scope and depth', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf1', target: 'https://example.com', config: config(), allowAny: false })
    runtime.enqueue('https://example.com/shallow', 1)
    runtime.enqueue('https://example.com/deep', 5)
    runtime.enqueue('https://other.example.net/x', 1)

    expect(runtime.countActionable(2)).toBe(1)
    expect(runtime.countActionable(10)).toBe(2)
  })

  it('reports agent_stopped when the driver quits with actionable frontier remaining', async () => {
    h.streamFactory = async function* () { /* model produces nothing and ends */ }
    const result = await runSpiderRuntime({
      config: config(),
      target: 'https://example.com',
      allowAny: false,
      browser: fakeBrowserPage(['https://example.com/a', 'https://example.com/b?x=1']),
    })
    expect(result.outcome.status).toBe('completed')
    expect(result.state.stopReason).toBe('agent_stopped')
    expect(result.state.frontier.length).toBeGreaterThan(0)
  })

  it('reports frontier_exhausted only when nothing actionable remains', async () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf1', target: 'https://example.com', config: config(), allowAny: false })
    runtime.enqueue('https://cdn.other.net/x', 1)  // proposed only
    // Simulate the terminal accounting used by the run loop:
    const stopped = runtime.stop(runtime.countActionable(2) > 0 ? 'agent_stopped' : 'frontier_exhausted')
    expect(stopped.stopReason).toBe('frontier_exhausted')

    const runtime2 = new SpiderRuntime({ workflowId: 'wf2', target: 'https://example.com', config: config(), allowAny: false })
    runtime2.enqueue('https://example.com/y', 1)
    const stopped2 = runtime2.stop(runtime2.countActionable(2) > 0 ? 'agent_stopped' : 'frontier_exhausted')
    expect(stopped2.stopReason).toBe('agent_stopped')
  })
})

describe('C2 â€” stale accounting on text-only output', () => {
  it('accrues stale rounds from large text deltas without tool calls', async () => {
    const bigText = 'x'.repeat(4500)
    let rounds = 0
    h.streamFactory = async function* () {
      while (rounds < 4) {
        rounds++
        yield { type: 'text-delta', payload: { text: bigText } }
      }
    }
    const result = await runSpiderRuntime({
      config: config({ antiLoop: { staleThreshold: 3 } }),
      target: 'https://example.com',
      allowAny: false,
      browser: fakeBrowserPage([]),
    })
    expect(result.state.stopReason).toBe('stale')
  })
})

describe('C3 â€” baseline endpoint hygiene', () => {
  it('records param-bearing links as endpoints; plain links only enter the frontier', async () => {
    h.streamFactory = async function* () { /* end immediately */ }
    const result = await runSpiderRuntime({
      config: config(),
      target: 'https://example.com',
      allowAny: false,
      browser: fakeBrowserPage([
        'https://example.com/about',
        'https://example.com/search?q=term',
        'https://example.com/items?id=7&sort=asc',
        'https://cdn.other.net/widget.js',
      ]),
    })

    const urls = result.state.endpoints.map((e) => e.url)
    expect(urls).toContain('https://example.com/search?q=term')
    expect(urls).toContain('https://example.com/items?id=7&sort=asc')
    expect(urls).not.toContain('https://example.com/about')
    expect(urls).not.toContain('https://cdn.other.net/widget.js')

    const search = result.state.endpoints.find((e) => e.url === 'https://example.com/items?id=7&sort=asc')
    expect(search?.params.sort()).toEqual(['id', 'sort'])

    // Plain links still queued for traversal.
    expect(result.state.frontier.some((f) => f.url === 'https://example.com/about')).toBe(true)
  })
})

describe('browser form target mapping', () => {
  it('uses Stagehand evaluate to read forms and links', async () => {
    h.streamFactory = async function* () { /* end immediately */ }
    const forms = [{
      selector: '#recover', method: 'POST', action: 'https://example.com/recover',
      fields: [{ name: 'email', type: 'email', required: true }],
    }]
    const browser = fakeBrowserPage([], forms)
    const page = browser.requireStagehand().context.activePage()
    const mergeEndpoint = vi.fn()

    const result = await runSpiderRuntime({
      config: config(),
      target: 'https://example.com/',
      allowAny: false,
      browser,
      graphStore: {
        queryNodes: () => [],
        mergePage: vi.fn(),
        mergeEndpoint,
        addReachability: vi.fn(),
        save: vi.fn(),
      },
    })

    expect(result.state.discoveredForms).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: [{ name: 'email', type: 'email', required: true }] }),
    ]))
    expect(page.evaluate.mock.calls.map(([extractor]: [Function]) => extractor.name)).toContain('extractFormsInPage')
    expect(mergeEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://example.com/recover',
      tags: ['html-form', 'target-provided'],
    }))
  })

  it('persists target-provided form routes and field schemas without values', async () => {
    h.streamFactory = async function* () { /* end immediately */ }
    const browser = fakeBrowserPage([], [{
      selector: '#redeem',
      method: 'POST',
      action: 'https://example.com/redeem?campaign=welcome&ticket=private-value',
      submitLabel: 'Apply offer',
      fields: [
        { name: 'offer', type: 'text', required: true, label: 'Offer code', value: 'WELCOME-SECRET' },
      ],
    }])
    const mergeEndpoint = vi.fn()
    const graphStore = {
      queryNodes: () => [],
      mergePage: vi.fn(),
      mergeEndpoint,
      addReachability: vi.fn(),
      save: vi.fn(),
    }

    const result = await runSpiderRuntime({
      config: config(),
      target: 'https://example.com/',
      allowAny: false,
      browser,
      graphStore,
    })

    expect(result.state.discoveredForms[0]).toMatchObject({
      selector: '#redeem',
      method: 'POST',
      action: 'https://example.com/redeem',
      submitLabel: 'Apply offer',
      fields: [{ name: 'offer', type: 'text', required: true, label: 'Offer code' }],
    })
    expect(JSON.stringify(result.state.discoveredForms)).not.toContain('WELCOME-SECRET')
    expect(mergeEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://example.com/redeem',
      source: 'browser-form',
      tags: ['html-form', 'target-provided'],
      params: [
        { name: 'campaign', type: 'string', in: 'query' },
        { name: 'ticket', type: 'string', in: 'query' },
        { name: 'offer', type: 'text', in: 'body', required: true },
      ],
    }))
    expect(JSON.stringify(mergeEndpoint.mock.calls)).not.toContain('private-value')
    expect(JSON.stringify(mergeEndpoint.mock.calls)).not.toContain('WELCOME-SECRET')

    const formEndpoint = { id: 'ep-form', type: 'Endpoint', properties: mergeEndpoint.mock.calls[0][0] }
    const campaign = planCampaign({
      queryNodes: (type: string) => type === 'Endpoint' ? [formEndpoint] : [],
      getAllEdges: () => [],
    } as any, { primitives: [
      { id: 'businessLogicAbuse', description: 'stateful business logic checks', tags: ['business'] },
      { id: 'workflowBypass', description: 'observed sequence replay', tags: ['workflow', 'business'] },
    ] })
    expect(campaign.slices.some(slice => slice.endpoint.id === 'ep-form' && slice.params.includes('offer'))).toBe(true)
    expect(campaign.slices.some(slice => slice.techniqueIds.includes('workflowBypass'))).toBe(false)
  })

  it('captures form schemas after the crawler reaches a later page', async () => {
    const browser = fakeBrowserPage([], url => url === 'https://example.com/account/recover' ? [{
      selector: '#reset',
      method: 'POST',
      action: 'https://example.com/account/recover',
      fields: [{ name: 'email', type: 'email', required: true }],
    }] : [])
    h.streamFactory = async function* () {
      browser.setPageUrl('https://example.com/account/recover')
      yield { type: 'tool-result', payload: { toolName: 'stagehand_navigate', result: { success: true } } }
    }
    const mergeEndpoint = vi.fn()
    const graphStore = {
      queryNodes: () => [],
      mergePage: vi.fn(),
      mergeEndpoint,
      addReachability: vi.fn(),
      save: vi.fn(),
    }

    const result = await runSpiderRuntime({
      config: config(),
      target: 'https://example.com/',
      allowAny: false,
      browser,
      graphStore,
    })

    expect(result.state.discoveredForms).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: 'https://example.com/account/recover', fields: [{ name: 'email', type: 'email', required: true }] }),
    ]))
    expect(mergeEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://example.com/account/recover',
      params: [{ name: 'email', type: 'email', in: 'body', required: true }],
    }))
  })

  it('does not promote a proposed cross-origin form action into the target graph', async () => {
    h.streamFactory = async function* () { /* end immediately */ }
    const mergeEndpoint = vi.fn()
    const result = await runSpiderRuntime({
      config: config(),
      target: 'https://example.com/',
      allowAny: false,
      browser: fakeBrowserPage([], [{
        selector: '#external',
        method: 'POST',
        action: 'https://other.example/submit',
        fields: [{ name: 'email', type: 'email', required: true }],
      }]),
      graphStore: {
        queryNodes: () => [],
        mergePage: vi.fn(),
        mergeEndpoint,
        addReachability: vi.fn(),
        save: vi.fn(),
      },
    })

    expect(result.state.discoveredForms[0]?.action).toBe('https://other.example/submit')
    expect(mergeEndpoint).not.toHaveBeenCalled()
  })
})

describe('landing navigation cancellation', () => {
  it('stops an aborted navigation and releases its target transport slot', async () => {
    const target = 'https://cancel.example'
    const controller = new AbortController()
    const browser = fakeBrowserPage([])
    const page = browser.requireStagehand().context.activePage()
    let stopNavigation: (() => void) | undefined
    page.goto = vi.fn(() => new Promise((_resolve, reject) => {
      stopNavigation = () => reject(new Error('Navigation stopped'))
    }))
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.stopLoading') stopNavigation?.()
    })
    ;(page as any).mainSession = { send }

    const run = runSpiderRuntime({ config: config(), target, allowAny: false, browser, signal: controller.signal })
    await vi.waitFor(() => expect(page.goto).toHaveBeenCalledOnce())
    controller.abort(new Error('test cancellation'))
    const result = await run

    expect(result.outcome).toEqual({ status: 'aborted', reason: 'Spider aborted' })
    expect(send).toHaveBeenCalledWith('Page.stopLoading')
    expect(getTargetTransportGovernor().stats(target).active).toBe(0)
    const release = await getTargetTransportGovernor().acquire(target)
    release()
  })
})
