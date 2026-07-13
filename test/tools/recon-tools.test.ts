import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/safety/scope-guard', () => ({
  isUrlInScope: vi.fn().mockReturnValue({ allowed: true }),
}))

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    resolve4 = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
    resolve6 = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
    resolveMx = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
    resolveTxt = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
    resolveCname = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
    resolveNs = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
  },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

let runRecon: typeof import('../../src/tools/recon-tools').runRecon
let graphqlIntrospect: typeof import('../../src/tools/recon-tools').graphqlIntrospect
let jwtDecode: typeof import('../../src/tools/recon-tools').jwtDecode
let frameworkFingerprint: typeof import('../../src/tools/recon-tools').frameworkFingerprint
let cloudMetadataProbe: typeof import('../../src/tools/recon-tools').cloudMetadataProbe
let isUrlInScope: typeof import('../../src/safety/scope-guard').isUrlInScope

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../../src/tools/recon-tools')
  runRecon = mod.runRecon
  graphqlIntrospect = mod.graphqlIntrospect
  jwtDecode = mod.jwtDecode
  frameworkFingerprint = mod.frameworkFingerprint
  cloudMetadataProbe = mod.cloudMetadataProbe
  isUrlInScope = (await import('../../src/safety/scope-guard')).isUrlInScope
  ;(isUrlInScope as any).mockReturnValue({ allowed: true })
})

afterEach(() => {
  mockFetch.mockReset()
})

function makeResponse(body: string, headers: Record<string, string> = {}, status = 200) {
  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: {
      forEach: (cb: Function) => {
        for (const [k, v] of Object.entries(headers)) cb(v, k)
      },
    },
  }
}

describe('runRecon', () => {
  it('returns tech fingerprint and subdomains for a URL', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(''))
      .mockResolvedValueOnce(makeResponse('<html></html>', { 'server': 'nginx' }))

    const result = await (runRecon.execute as any)({ target: 'example.com', probes: ['tech-stack'] })
    expect(result.ok).toBe(true)
    expect(result.value.techStack).toBeDefined()
    expect(Array.isArray(result.value.techStack)).toBe(true)
  })

  it('detects Next.js and React frameworks from HTML', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse('<html><div id="__NEXT_DATA__"></div><div data-reactroot></div></html>', { 'server': 'cloudflare' })
    )

    const result = await (runRecon.execute as any)({ target: 'example.com', probes: ['tech-stack'] })
    expect(result.ok).toBe(true)
    const names = result.value.techStack.map((f: any) => f.name)
    expect(names).toContain('Next.js')
    expect(names).toContain('React')
    expect(names).toContain('Cloudflare')
  })

  it('returns empty techStack when scope check fails', async () => {
    ;(isUrlInScope as any).mockReturnValue({ allowed: false, reason: 'out of scope' })

    const result = await (runRecon.execute as any)({ target: 'evil.com', probes: ['tech-stack'] })
    expect(result.ok).toBe(true)
    expect(result.value.techStack).toEqual([])
  })
})

describe('graphqlIntrospect', () => {
  it('sends correct introspection query', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(JSON.stringify({
      data: {
        __schema: {
          types: [
            { name: 'Query', fields: [{ name: 'getUser' }, { name: 'listPosts' }] },
            { name: 'Mutation', fields: [{ name: 'createPost' }] },
            { name: 'User', fields: [{ name: 'id' }, { name: 'name' }] },
            { name: '__Schema', fields: [] },
          ],
        },
      },
    })))

    const result = await (graphqlIntrospect.execute as any)({ url: 'https://example.com/graphql' })
    expect(result.ok).toBe(true)
    expect(result.value.introspectionEnabled).toBe(true)
    expect(result.value.queryCount).toBe(2)
    expect(result.value.mutationCount).toBe(1)
    expect(result.value.typeCount).toBe(3)

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.query).toContain('__schema')
    expect(callArgs[1].method).toBe('POST')
  })

  it('returns scope violation when out of scope', async () => {
    ;(isUrlInScope as any).mockReturnValue({ allowed: false, reason: 'not allowed' })

    const result = await (graphqlIntrospect.execute as any)({ url: 'https://evil.com/graphql' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Scope violation')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('handles introspection disabled response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(JSON.stringify({ data: { __schema: null } })))

    const result = await (graphqlIntrospect.execute as any)({ url: 'https://example.com/graphql' })
    expect(result.ok).toBe(true)
    expect(result.value.introspectionEnabled).toBe(false)
    expect(result.value.typeCount).toBe(0)
  })
})

describe('jwtDecode', () => {
  it('decodes a JWT and checks algorithm', async () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: '123', name: 'Test User', exp: 9999999999 }))
    const token = `${header}.${payload}.fake-sig`

    const result = await (jwtDecode.execute as any)({ token })
    expect(result.ok).toBe(true)
    expect(result.value.algorithm).toBe('HS256')
    expect(result.value.algorithmVulnerable).toBe(true)
    expect(result.value.payload.sub).toBe('123')
    expect(result.value.isExpired).toBe(false)
  })

  it('detects expired tokens', async () => {
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: '1', exp: 1000000000 }))
    const token = `${header}.${payload}.sig`

    const result = await (jwtDecode.execute as any)({ token })
    expect(result.ok).toBe(true)
    expect(result.value.algorithm).toBe('RS256')
    expect(result.value.algorithmVulnerable).toBe(false)
    expect(result.value.isExpired).toBe(true)
  })

  it('rejects tokens with invalid format', async () => {
    const result = await (jwtDecode.execute as any)({ token: 'not-a-jwt' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid JWT format')
  })

  it('detects none algorithm as vulnerable', async () => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: '1', exp: 9999999999 }))
    const token = `${header}.${payload}.`

    const result = await (jwtDecode.execute as any)({ token })
    expect(result.ok).toBe(true)
    expect(result.value.algorithmVulnerable).toBe(true)
  })
})

describe('frameworkFingerprint', () => {
  it('identifies frameworks from headers and HTML', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(
        '<html><script src="jquery-3.6.0.min.js"></script><div id="app"></div></html>',
        { 'server': 'nginx/1.22', 'x-powered-by': 'Express' },
      )
    )

    const result = await (frameworkFingerprint.execute as any)({ url: 'https://example.com' })
    expect(result.ok).toBe(true)
    const names = result.value.frameworks.map((f: any) => f.name)
    expect(names).toContain('jQuery')
    expect(names).toContain('Express')
    expect(names).toContain('Server')
  })

  it('detects WordPress from HTML markers', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse('<html><link href="wp-content/themes/style.css" rel="stylesheet"></html>')
    )

    const result = await (frameworkFingerprint.execute as any)({ url: 'https://example.com' })
    expect(result.ok).toBe(true)
    const names = result.value.frameworks.map((f: any) => f.name)
    expect(names).toContain('WordPress')
  })

  it('returns scope violation for out-of-scope URLs', async () => {
    ;(isUrlInScope as any).mockReturnValue({ allowed: false, reason: 'blocked' })

    const result = await (frameworkFingerprint.execute as any)({ url: 'https://evil.com' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Scope violation')
  })
})

describe('cloudMetadataProbe', () => {
  it('calls isUrlInScope before probing', async () => {
    ;(isUrlInScope as any).mockReturnValue({ allowed: false, reason: 'no scope' })

    const result = await (cloudMetadataProbe.execute as any)({ url: 'https://example.com' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Scope violation')
    expect(isUrlInScope).toHaveBeenCalledWith('https://example.com')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('probes multiple cloud providers when in scope', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    })

    const result = await (cloudMetadataProbe.execute as any)({ url: 'https://example.com' })
    expect(result.ok).toBe(true)
    expect(result.value.probes).toBeDefined()
    expect(result.value.probes.length).toBeGreaterThan(0)
    const providers = result.value.probes.map((p: any) => p.provider)
    expect(providers).toContain('AWS')
    expect(providers).toContain('GCP')
    expect(providers).toContain('Azure')
  })
})
