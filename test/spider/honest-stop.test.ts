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

function config(overrides: Record<string, unknown> = {}) {
  return {
    spider: { maxPages: 50, maxDepth: 2, maxDurationMs: 30_000 },
    agent: { maxSteps: 40 },
    timeout: 5000,
    antiLoop: { staleThreshold: 3 },
    ...overrides,
  } as any
}

function fakeBrowserPage(links: string[]) {
  const page = {
    goto: vi.fn(async () => ({ status: () => 200 })),
    url: vi.fn(() => 'https://example.com/'),
    title: vi.fn(async () => 'Home'),
    $$eval: vi.fn(async (selector: string) => {
      if (selector === 'a[href]') return links
      if (selector === 'form') return []
      return []
    }),
  }
  return {
    requireStagehand: () => ({ context: { activePage: () => page } }),
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
