import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const recorded: any[] = []

const mockStore = {
  addEndpoint: vi.fn((data: any) => {
    recorded.push(data)
    return { id: `ep_${recorded.length}`, type: 'Endpoint', properties: data }
  }),
  addFinding: vi.fn((data: any) => ({ id: `f_${Math.random()}`, type: 'Finding', properties: data })),
  addFact: vi.fn((data: any) => ({ id: `fact_${Math.random()}`, type: 'Fact', properties: data })),
  queryNodes: vi.fn(() => []),
  queryEdges: vi.fn(() => []),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

vi.mock('../../src/analysis/analyser', () => ({
  runAnalysis: vi.fn().mockResolvedValue(undefined),
}))

// Deterministic self-origin: externalHost -> https://oast.example.com (port 443)
vi.mock('../../src/oast/server', () => ({
  getOastUrl: () => 'https://oast.example.com',
}))

import { bridgeHARToGraph } from '../../src/analysis/har-bridge'

function harWithEntries(urls: string[]): string {
  const entries = urls.map((url, i) => ({
    request: { method: 'GET', url, headers: [{ name: 'host', value: new URL(url).host }], queryString: [], cookies: [] },
    response: { status: 200, statusText: 'OK', headers: [{ name: 'content-type', value: 'application/json' }], content: { mimeType: 'application/json', text: '{}', size: 2 }, cookies: [] },
    startedDateTime: new Date().toISOString(),
    time: 1,
    cache: {},
    timings: {},
  }))
  return JSON.stringify({ log: { version: '1.2', creator: { name: 't', version: '1' }, entries } })
}

describe('har-bridge origin tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recorded.length = 0
  })

  it('tags a localhost DEV TARGET as origin:"target" (no false drop)', async () => {
    await bridgeHARToGraph(harWithEntries(['http://localhost:3000/api/users']), 'http://localhost:3000')
    const ep = recorded.find((r) => r.url?.includes('localhost:3000'))
    expect(ep).toBeTruthy()
    expect(ep.origin).toBe('target')
  })

  it('tags our OAST callback host as origin:"self"', async () => {
    await bridgeHARToGraph(harWithEntries(['https://oast.example.com/cb/abc']), 'http://localhost:3000')
    const ep = recorded.find((r) => r.url?.includes('oast.example.com'))
    expect(ep).toBeTruthy()
    expect(ep.origin).toBe('self')
    expect(ep.tags).toContain('self-traffic')
  })

  it('captures BOTH target and self traffic (capture-all, nothing dropped)', async () => {
    const res = await bridgeHARToGraph(
      harWithEntries(['http://localhost:3000/api/a', 'https://oast.example.com/cb/x']),
      'http://localhost:3000',
    )
    expect(res.endpointsWritten).toBe(2)
  })

  it('writes RAW secret value into the finding description (evidence stays precise/lethal)', async () => {
    const jwt = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxfQ.abc123secret'
    const har = JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 't', version: '1' },
        entries: [
          {
            request: { method: 'GET', url: 'http://localhost:3000/api/me', headers: [{ name: 'authorization', value: jwt }], queryString: [], cookies: [] },
            response: { status: 200, statusText: 'OK', headers: [], content: { mimeType: 'application/json', text: '{}', size: 2 }, cookies: [] },
            startedDateTime: new Date().toISOString(),
            time: 1,
            cache: {},
            timings: {},
          },
        ],
      },
    })
    await bridgeHARToGraph(har, 'http://localhost:3000')
    const secretFinding = (mockStore.addFinding as any).mock.calls.find(
      (c: any[]) => c[0].technique === 'Secret Exposure: token',
    )
    expect(secretFinding).toBeTruthy()
    // The graph evidence must contain the REAL token, not a mask.
    expect(secretFinding[0].description).toContain(jwt)
    expect(secretFinding[0].description).not.toContain('****')
  })

  it('tags secrets found in a self entry as self-traffic', async () => {
    const entries = [
      {
        request: { method: 'GET', url: 'https://oast.example.com/cb/x', headers: [{ name: 'authorization', value: 'Bearer eyJ' }], queryString: [], cookies: [] },
        response: { status: 200, statusText: 'OK', headers: [], content: { mimeType: 'text/plain', size: 0 }, cookies: [] },
        startedDateTime: new Date().toISOString(), time: 1, cache: {}, timings: {},
      },
    ]
    const har = JSON.stringify({ log: { version: '1.2', creator: { name: 't', version: '1' }, entries } })
    await bridgeHARToGraph(har, 'http://localhost:3000')
    const finding = (mockStore.addFinding as any).mock.calls.find((c: any[]) => c[0].tags?.includes('self-traffic'))
    expect(finding).toBeTruthy()
  })
})
