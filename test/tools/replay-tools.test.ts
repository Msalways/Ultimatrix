/**
 * P3.1 replay seam tests â€” CapturedRequestStore + listCapturedRequests /
 * replayCapturedRequest tools.
 *
 * The replay path routes through the real httpRequest tool (scope guard,
 * evidence recording), with global fetch stubbed at the network boundary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  CapturedRequestStore,
  getCapturedRequestStore,
} from '../../src/capture/captured-request-store'
import { listCapturedRequests, replayCapturedRequest } from '../../src/tools/replay-tools'
import { httpRequest } from '../../src/tools/http-tools'
import { getGlobalWorkspace } from '../../src/workspace'
import type { HarEntry } from '../../src/capture/har-parser'

function harEntry(overrides: Partial<HarEntry['request']> & { url: string; method: string }): HarEntry {
  return {
    startedDateTime: '2026-01-01T00:00:00Z',
    time: 10,
    request: {
      headers: [{ name: 'Authorization', value: 'Bearer tok' }],
      queryString: [],
      ...overrides,
    },
    response: {
      status: 200,
      headers: [{ name: 'content-type', value: 'text/html' }],
      content: { text: '<html>ok</html>' },
    },
  } as unknown as HarEntry
}

const realFetch = globalThis.fetch

/** The HTTP tool prefetches robots.txt per origin â€” keep only real request calls. */
function realRequestCalls(spy: ReturnType<typeof vi.fn>): unknown[][] {
  return spy.mock.calls.filter(([u]) => !String(u).endsWith('/robots.txt'))
}

beforeEach(() => {
  getCapturedRequestStore().clear()
  try {
    getGlobalWorkspace().setTarget('https://target.example', { name: 't' })
  } catch { /* workspace already configured */ }
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('CapturedRequestStore', () => {
  it('assigns stable sequential ids and round-trips full records', () => {
    const store = new CapturedRequestStore()
    const a = store.record({ method: 'GET', url: 'https://x.example/a' })
    const b = store.record({ method: 'POST', url: 'https://x.example/b', body: 'p=1', status: 404 })
    expect(a.id).toBe('cap-1')
    expect(b.id).toBe('cap-2')
    const got = store.get('cap-2')
    expect(got?.method).toBe('POST')
    expect(got?.body).toBe('p=1')
    expect(got?.status).toBe(404)
    expect(store.get('cap-999')).toBeNull()
  })

  it('ingests HAR entries with request+response fidelity', () => {
    const store = new CapturedRequestStore()
    const n = store.ingestHarEntries([
      harEntry({ url: 'https://api.example/v1/users', method: 'GET' }),
      harEntry({ url: 'https://api.example/v1/login', method: 'POST' }),
    ])
    expect(n).toBe(2)
    const refs = store.list()
    expect(refs.map(r => r.url)).toEqual([
      'https://api.example/v1/users',
      'https://api.example/v1/login',
    ])
    const full = store.get(refs[0].id)
    expect(full?.headers['Authorization']).toBe('Bearer tok')
    expect(full?.responseBody).toBe('<html>ok</html>')
    expect(full?.source).toBe('har')
  })

  it('filters by method/host/urlContains with limit', () => {
    const store = new CapturedRequestStore()
    for (let i = 0; i < 3; i++) store.record({ method: 'GET', url: `https://a.example/p${i}` })
    for (let i = 0; i < 3; i++) store.record({ method: 'POST', url: `https://b.example/q${i}` })
    expect(store.list({ method: 'post' })).toHaveLength(3)
    expect(store.list({ host: 'b.example' })).toHaveLength(3)
    expect(store.list({ urlContains: '/q' })).toHaveLength(3)
    expect(store.list()).toHaveLength(6)
    expect(store.list({ limit: 2 })).toHaveLength(2)
  })
})

describe('listCapturedRequests tool', () => {
  it('returns compact refs and total count', async () => {
    const store = getCapturedRequestStore()
    store.record({ method: 'GET', url: 'https://target.example/list', status: 200 })
    store.record({ method: 'POST', url: 'https://target.example/save', body: 'x=1', status: 302 })

    const res = await listCapturedRequests.execute({})
    expect(res.ok).toBe(true)
    expect(res.value.totalCaptured).toBe(2)
    expect(res.value.matches[0]).toMatchObject({
      id: 'cap-1',
      method: 'GET',
      status: 200,
      source: 'tool',
    })

    const filtered = await listCapturedRequests.execute({ method: 'POST' })
    expect(filtered.value.matches).toHaveLength(1)
    expect(filtered.value.matches[0].id).toBe('cap-2')
  })
})

describe('replayCapturedRequest tool', () => {
  it('rejects unknown entry ids without sending anything', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const res = await replayCapturedRequest.execute({ entryId: 'cap-404' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Unknown entry id')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('replays verbatim when no mutations are given', async () => {
    getCapturedRequestStore().record({
      method: 'POST',
      url: 'https://target.example/api/orders',
      headers: { 'content-type': 'application/json' },
      body: '{"total":100}',
      status: 200,
    })
    const fetchSpy = vi.fn(async () => new Response('{"total":100}', { status: 200 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const res = await replayCapturedRequest.execute({ entryId: 'cap-1' })
    expect(res.ok).toBe(true)
    const [, init] = realRequestCalls(fetchSpy)[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"total":100}')
    expect(res.value.originalStatus).toBe(200)
    expect(res.value.replayedStatus).toBe(200)
    expect(res.value.statusDelta).toBe('200 \u2192 200');
  })

  it('applies structural mutations: header set/remove + body swap + url override', async () => {
    getCapturedRequestStore().record({
      method: 'POST',
      url: 'https://target.example/api/coupon',
      headers: { 'X-Old': 'yes', 'content-type': 'application/json' },
      body: '{"code":"SAVE1"}',
      status: 400,
    })
    const fetchSpy = vi.fn(async () => new Response('ok', { status: 201 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const res = await replayCapturedRequest.execute({
      entryId: 'cap-1',
      setHeaders: { 'x-old': 'no' },   // case-insensitive override
      removeHeaderNames: ['Content-Type'],
      body: '{"code":"FREE"}',
      url: 'https://target.example/api/admin-coupon',
    })
    expect(res.ok).toBe(true)

    const [sentUrl, init] = realRequestCalls(fetchSpy)[0] as [string, RequestInit]
    expect(sentUrl).toBe('https://target.example/api/admin-coupon')
    expect((init.headers as Record<string, string>)['x-old']).toBe('no')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect(init.body).toBe('{"code":"FREE"}')
    expect(res.value.statusDelta).toBe('400 \u2192 201');

    // replay went through the real evidence path
    expect(res.value.requestSent.body).toBe('{"code":"FREE"}')
  })

  it('appends to captured body and promotes GET to POST only when a body exists', async () => {
    getCapturedRequestStore().record({
      method: 'POST',
      url: 'https://target.example/search',
      body: 'q=a',
      status: 200,
    })
    const fetchSpy = vi.fn(async () => new Response('', { status: 204 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await replayCapturedRequest.execute({ entryId: 'cap-1', appendBody: '&admin=1' })
    const [, init] = realRequestCalls(fetchSpy)[0] as [string, RequestInit]
    expect(init.body).toBe('q=a&admin=1')
  })

  it('strips bodies on GET/HEAD replays to honor the HTTP tool contract', async () => {
    getCapturedRequestStore().record({
      method: 'POST',
      url: 'https://target.example/x',
      body: 'data',
      status: 200,
    })
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await replayCapturedRequest.execute({ entryId: 'cap-1', method: 'GET' })
    const [, init] = realRequestCalls(fetchSpy)[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('surfaces scope-guard denial from the underlying HTTP tool', async () => {
    const mod = await import('../../src/safety/scope-guard')
    const prevAllowAny = (mod as any).isAllowAny()
    mod.setScopeConfig({ allowedDomains: ['example.net'] })
    mod.setAllowAny(false)
    try {
      getCapturedRequestStore().record({
        method: 'GET',
        url: 'https://target.example/in-scope',
        status: 200,
      })
      const res = await replayCapturedRequest.execute({
        entryId: 'cap-1',
        url: 'https://evil.example/exfil',
      })
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/[Ss]cope/)
    } finally {
      mod.setScopeConfig(null)
    mod.setAllowAny(prevAllowAny)
    }
  })
})
