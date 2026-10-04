import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { __setTestFallback } from '../../src/runtime/engagement-context'
import { TargetTransportGovernor } from '../../src/runtime/target-governor'

const { forensicLogSpy } = vi.hoisted(() => ({ forensicLogSpy: vi.fn() }))

vi.mock('../../src/safety/scope-guard', () => ({
  isUrlInScope: vi.fn().mockReturnValue({ allowed: true }),
  getScopeConfig: vi.fn().mockReturnValue(null),
  enforceAction: vi.fn(),
  enforceHttpMethod: vi.fn(),
}))

vi.mock('../../src/tools/report-tools', () => ({
  getForensicLog: vi.fn().mockReturnValue({ log: forensicLogSpy }),
}))

vi.mock('../../src/tools/control-tools', () => ({
  recordStructuredEvidence: vi.fn(() => ({ id: 'test-evidence' })),
}))

vi.mock('../../src/compression/headroom-service', () => ({
  CompressionService: class {
    async compressResponse(body: string) {
      return { compressed: body, wasCompressed: false, wasTruncated: false }
    }
  },
  getCompressionService: () => ({
    async compressResponse(body: string) {
      return { compressed: body, wasCompressed: false, wasTruncated: false }
    }
  }),
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), dim: vi.fn() },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

let httpRequest: typeof import('../../src/tools/http-tools').httpRequest
let isUrlInScope: typeof import('../../src/safety/scope-guard').isUrlInScope

let testCounter = 0
function uniqueHost(suffix: string) {
  testCounter++
  return `hrl${testCounter}-${suffix}.com`
}

function makeOkResponse(body = 'ok', status = 200) {
  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    text: async () => body,
    headers: {
      forEach(cb: Function) { cb('text/html', 'content-type') },
      get(name: string) { return name === 'retry-after' ? null : null },
    },
  }
}

function make429Response(retryAfterSec?: number) {
  return {
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    text: async () => 'rate limited',
    headers: {
      forEach(cb: Function) { cb('text/plain', 'content-type') },
      get(name: string) { return name === 'retry-after' ? String(retryAfterSec ?? 1) : null },
    },
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  testCounter++
  __setTestFallback({ targetGovernor: new TargetTransportGovernor({ requestsPerMinute: 60, maxConcurrent: 4, maxRequests: 100 }) } as any)

  const mod = await import('../../src/tools/http-tools')
  httpRequest = mod.httpRequest
  isUrlInScope = (await import('../../src/safety/scope-guard')).isUrlInScope
  ;(isUrlInScope as any).mockReturnValue({ allowed: true })
})

afterEach(() => {
  mockFetch.mockReset()
  __setTestFallback(null)
})

describe('Per-host delay enforcement', () => {
  it('enforces delay between requests to the same host', async () => {
    const host = uniqueHost('delay')
    const fetchStartedAt: number[] = []
    mockFetch.mockImplementation(async () => {
      fetchStartedAt.push(Date.now())
      return makeOkResponse()
    })

    const r1 = await httpRequest.execute({ method: 'GET', url: `https://${host}/a`, timeoutMs: 5000 } as any)
    expect(r1.ok, JSON.stringify(r1)).toBe(true)

    const r2 = await httpRequest.execute({ method: 'GET', url: `https://${host}/b`, timeoutMs: 5000 } as any)
    expect(r2.ok).toBe(true)
    expect(fetchStartedAt[1] - fetchStartedAt[0]).toBeGreaterThanOrEqual(150)
  })

  it('does NOT delay requests to different hosts', async () => {
    // Skip robots.txt so a single call issues exactly one wire request to the
    // new origin; otherwise the intra-origin pacing floor between robots.txt
    // and the target would mask the cross-host behaviour under test.
    const { getScopeConfig } = await import('../../src/safety/scope-guard')
    ;(getScopeConfig as any).mockReturnValue({ authorizedPentest: true })
    try {
      const host1 = uniqueHost('diffa')
      const host2 = uniqueHost('diffb')
      mockFetch.mockResolvedValue(makeOkResponse())

      const r1 = await httpRequest.execute({ method: 'GET', url: `https://${host1}/x`, timeoutMs: 5000 } as any)
      expect(r1.ok, JSON.stringify(r1)).toBe(true)

      const start = Date.now()
      const r2 = await httpRequest.execute({ method: 'GET', url: `https://${host2}/x`, timeoutMs: 5000 } as any)
      const elapsed = Date.now() - start
      expect(r2.ok).toBe(true)
      expect(elapsed).toBeLessThan(150)
    } finally {
      ;(getScopeConfig as any).mockReturnValue(null)
    }
  })
})

describe('429 backoff retry', () => {
  it('counts each retry against an active campaign request budget', async () => {
    const { getScopeConfig } = await import('../../src/safety/scope-guard')
    ;(getScopeConfig as any).mockReturnValue({ authorizedPentest: true })
    let reservations = 0
    __setTestFallback({
      targetGovernor: new TargetTransportGovernor({ requestsPerMinute: 60, maxConcurrent: 4, maxRequests: 100 }),
      campaignRequestBudget: () => ++reservations <= 1,
    } as any)
    mockFetch.mockResolvedValue(make429Response(1))

    const result = await httpRequest.execute({
      method: 'GET',
      url: `https://${uniqueHost('campaign-budget')}/page`,
      timeoutMs: 5000,
    } as any)

    expect(result.ok).toBe(false)
    expect((result as any).error).toContain('campaign request/time budget')
    expect(reservations).toBe(2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    ;(getScopeConfig as any).mockReturnValue(null)
  })

  it('retries on 429 and returns 200 on second attempt', async () => {
    const host = uniqueHost('retry')
    let calls = 0
    mockFetch.mockImplementation(async (url: string) => {
      calls++
      if (calls === 1) return make429Response(1)
      return makeOkResponse()
    })

    const result = await httpRequest.execute({
      method: 'GET',
      url: `https://${host}/page`,
      timeoutMs: 5000,
    } as any)

    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(calls).toBe(2)
  })

  it('returns error after max 429 retries exhausted', async () => {
    const host = uniqueHost('maxretry')
    mockFetch.mockResolvedValue(make429Response(1))

    const result = await httpRequest.execute({
      method: 'GET',
      url: `https://${host}/page`,
      timeoutMs: 5000,
    } as any)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('429')
  })
})

describe('failed HTTP request evidence', () => {
  it('records the failure and target governor state in the forensic log', async () => {
    const { getScopeConfig } = await import('../../src/safety/scope-guard')
    const host = uniqueHost('forensic-failure')
    ;(getScopeConfig as any).mockReturnValue({ authorizedPentest: true })
    mockFetch.mockRejectedValue(new Error('simulated socket failure'))

    try {
      const result = await httpRequest.execute({
        method: 'GET',
        url: `https://${host}/search?q=apple`,
        timeoutMs: 1000,
      } as any)

      expect(result).toMatchObject({ ok: false, error: 'simulated socket failure' })
      expect(forensicLogSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool-error',
        tool: 'httpRequest',
        error: 'simulated socket failure',
        args: expect.objectContaining({
          method: 'GET',
          url: `https://${host}/search?q=apple`,
          timeoutMs: 1000,
          targetTransport: expect.objectContaining({
            origin: `https://${host}`,
            requestsUsed: expect.any(Number),
            maxRequests: 100,
            requestsInWindow: expect.any(Number),
            active: 0,
            nextAvailableInMs: expect.any(Number),
          }),
        }),
      }))
    } finally {
      ;(getScopeConfig as any).mockReturnValue(null)
    }
  })
})

describe('robots.txt blocking', () => {
  it('blocks requests disallowed by robots.txt', async () => {
    const host = uniqueHost('block')
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('robots.txt')) {
        return { ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /private/\n', headers: { forEach() {}, get() { return null } } }
      }
      return makeOkResponse()
    })

    const blocked = await httpRequest.execute({
      method: 'GET',
      url: `https://${host}/private/secret`,
      timeoutMs: 5000,
    } as any)

    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('robots.txt')
  })

  it('allows requests to paths not in robots.txt disallow', async () => {
    const host = uniqueHost('allow')
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('robots.txt')) {
        return { ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /private/\n', headers: { forEach() {}, get() { return null } } }
      }
      return makeOkResponse()
    })

    const result = await httpRequest.execute({
      method: 'GET',
      url: `https://${host}/public/page`,
      timeoutMs: 5000,
    } as any)

    expect(result.ok, JSON.stringify(result)).toBe(true)
  })

  it('allows all when robots.txt is unavailable', async () => {
    const host = uniqueHost('norobots')
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('robots.txt')) throw new Error('network error')
      return makeOkResponse()
    })

    const result = await httpRequest.execute({
      method: 'GET',
      url: `https://${host}/page`,
      timeoutMs: 5000,
    } as any)

    expect(result.ok, JSON.stringify(result)).toBe(true)
  })
})
