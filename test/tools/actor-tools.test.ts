/**
 * Tests for actor-tools (Phase D: Actor/Session Refs)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/safety/scope-guard', () => ({
  isUrlInScope: vi.fn().mockReturnValue({ allowed: true }),
}))

vi.mock('../../src/http/robots', () => ({
  isAllowedByRobots: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/http/session-manager', () => {
  const sessions = new Map<string, any>()
  return {
    getGlobalSessionManager: vi.fn(() => ({
      listSessions: vi.fn(() => Array.from(sessions.keys())),
      exportSession: vi.fn((name: string) => sessions.get(name)),
      getAllHeaders: vi.fn((name: string) => {
        const s = sessions.get(name)
        if (!s) return {}
        const h: Record<string, string> = {}
        if (s.token) h['Authorization'] = `Bearer ${s.token}`
        if (Object.keys(s.cookies ?? {}).length > 0) {
          h['Cookie'] = Object.entries(s.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
        }
        return h
      }),
      importSession: vi.fn((session: any) => { sessions.set(session.name, session) }),
    })),
    __sessions: sessions,
  }
})

// We need to mock the CapturedRequestStore
vi.mock('../../src/capture/captured-request-store', () => {
  const store = new Map<string, any>()
  let seq = 0
  return {
    getCapturedRequestStore: vi.fn(() => ({
      get: vi.fn((id: string) => store.get(id)),
      list: vi.fn(() => [...store.values()].map(r => ({ id: r.id, method: r.method, url: r.url, status: r.status, source: r.source }))),
      record: vi.fn((req: any) => {
        seq++
        const id = `cap-${seq}`
        store.set(id, { id, ...req, capturedAt: Date.now() })
        return id
      }),
      size: store.size,
      __store: store,
      __reset: () => { store.clear(); seq = 0 },
    })),
  }
})

describe('listActors', () => {
  let listActorsTool: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../src/tools/actor-tools')
    listActorsTool = mod.listActors
  })

  it('returns empty list when no sessions', async () => {
    const result = await listActorsTool.execute!({} as any, {} as any)
    expect(result.ok).toBe(true)
    expect(result.actors).toHaveLength(0)
  })

  it('returns available sessions', async () => {
    const { __sessions } = await import('../../src/http/session-manager') as any
    __sessions.set('admin:https://example.com', {
      name: 'admin:https://example.com',
      baseUrl: 'https://example.com',
      token: 'tok_abc123',
      cookies: { session: 's1' },
    })
    __sessions.set('guest:https://example.com', {
      name: 'guest:https://example.com',
      baseUrl: 'https://example.com',
      cookies: {},
    })

    const result = await listActorsTool.execute!({} as any, {} as any)
    expect(result.ok).toBe(true)
    expect(result.actors).toHaveLength(2)

    const admin = result.actors.find((a: any) => a.name === 'admin:https://example.com')
    expect(admin).toBeDefined()
    expect(admin.hasToken).toBe(true)
    expect(admin.cookieCount).toBe(1)

    const guest = result.actors.find((a: any) => a.name === 'guest:https://example.com')
    expect(guest).toBeDefined()
    expect(guest.hasToken).toBe(false)
    expect(guest.cookieCount).toBe(0)
  })
})

describe('requestAsActor', () => {
  let requestAsActorTool: any
  let capturedStore: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../src/tools/actor-tools')
    requestAsActorTool = mod.requestAsActor
    const capturedMod = await import('../../src/capture/captured-request-store')
    capturedStore = (capturedMod.getCapturedRequestStore() as any)
    capturedStore.__reset()
  })

  it('returns error when captured request not found', async () => {
    const result = await requestAsActorTool.execute!({
      capturedRequestId: 'cap-999',
      actorId: 'admin:https://example.com',
    } as any, {} as any)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown captured request')
  })

  it('returns error when actor not in session store', async () => {
    // Record a request first
    capturedStore.__store.set('cap-1', {
      id: 'cap-1',
      method: 'GET',
      url: 'https://example.com/api/users/123',
      headers: { Accept: 'application/json' },
      status: 200,
      source: 'tool',
    })

    const result = await requestAsActorTool.execute!({
      capturedRequestId: 'cap-1',
      actorId: 'nonexistent:https://example.com',
    } as any, {} as any)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
    expect(result.error).toContain('unauthenticated')
  })

  it('replays with unauthenticated actor (no auth headers)', async () => {
    capturedStore.__store.set('cap-1', {
      id: 'cap-1',
      method: 'GET',
      url: 'https://example.com/api/users/123',
      headers: { Accept: 'application/json', 'Authorization': 'Bearer owner-token' },
      status: 200,
      source: 'tool',
    })

    // Mock httpRequest to capture what it receives
    const { httpRequest } = await import('../../src/tools/http-tools')
    const originalExecute = httpRequest.execute
    let capturedHeaders: Record<string, string> = {}
    httpRequest.execute = vi.fn(async (input: any) => {
      capturedHeaders = input.headers
      return { ok: true, value: { status: 403, headers: {}, body: 'Forbidden', durationMs: 50 } }
    }) as any

    try {
      const result = await requestAsActorTool.execute!({
        capturedRequestId: 'cap-1',
        actorId: 'unauthenticated',
      } as any, {} as any)

      expect(result.ok).toBe(true)
      expect(result.value.actorId).toBe('unauthenticated')
      expect(result.value.originalStatus).toBe(200)
      expect(result.value.actorStatus).toBe(403)
      expect(result.value.statusDelta).toBe('200 → 403')
      // Owner token should be stripped (only captured headers remain, no actor headers added)
      expect(capturedHeaders['Authorization']).toBeUndefined()
    } finally {
      httpRequest.execute = originalExecute
    }
  })

  it('replays with authenticated actor', async () => {
    capturedStore.__store.set('cap-1', {
      id: 'cap-1',
      method: 'GET',
      url: 'https://example.com/api/users/123',
      headers: { Accept: 'application/json', 'Authorization': 'Bearer owner-token' },
      status: 200,
      source: 'tool',
    })

    // Set up actor session
    const { __sessions } = await import('../../src/http/session-manager') as any
    __sessions.set('attacker:https://example.com', {
      name: 'attacker:https://example.com',
      baseUrl: 'https://example.com',
      token: 'attacker-token-xyz',
      cookies: { alt_session: 'abc' },
    })

    const { httpRequest } = await import('../../src/tools/http-tools')
    const originalExecute = httpRequest.execute
    let capturedHeaders: Record<string, string> = {}
    httpRequest.execute = vi.fn(async (input: any) => {
      capturedHeaders = input.headers
      return { ok: true, value: { status: 200, headers: {}, body: '{"role":"user"}', durationMs: 80 } }
    }) as any

    try {
      const result = await requestAsActorTool.execute!({
        capturedRequestId: 'cap-1',
        actorId: 'attacker:https://example.com',
      } as any, {} as any)

      expect(result.ok).toBe(true)
      expect(result.value.actorId).toBe('attacker:https://example.com')
      // Actor headers override captured
      expect(capturedHeaders['Authorization']).toBe('Bearer attacker-token-xyz')
      expect(capturedHeaders['Cookie']).toContain('alt_session=abc')
      // Original owner token is gone
      expect(capturedHeaders['Cookie']).not.toContain('owner-token')
    } finally {
      httpRequest.execute = originalExecute
    }
  })

  it('allows explicit header overrides on top of actor headers', async () => {
    capturedStore.__store.set('cap-1', {
      id: 'cap-1',
      method: 'GET',
      url: 'https://example.com/api/items',
      headers: {},
      source: 'tool',
    })

    const { __sessions } = await import('../../src/http/session-manager') as any
    __sessions.set('admin:https://example.com', {
      name: 'admin:https://example.com',
      baseUrl: 'https://example.com',
      token: 'admin-token',
      cookies: {},
    })

    const { httpRequest } = await import('../../src/tools/http-tools')
    const originalExecute = httpRequest.execute
    let capturedHeaders: Record<string, string> = {}
    httpRequest.execute = vi.fn(async (input: any) => {
      capturedHeaders = input.headers
      return { ok: true, value: { status: 200, headers: {}, body: '', durationMs: 30 } }
    }) as any

    try {
      const result = await requestAsActorTool.execute!({
        capturedRequestId: 'cap-1',
        actorId: 'admin:https://example.com',
        headers: { 'X-Custom-Override': 'yes' },
      } as any, {} as any)

      expect(result.ok).toBe(true)
      expect(capturedHeaders['Authorization']).toBe('Bearer admin-token')
      expect(capturedHeaders['X-Custom-Override']).toBe('yes')
    } finally {
      httpRequest.execute = originalExecute
    }
  })

  it('supports URL and method overrides', async () => {
    capturedStore.__store.set('cap-1', {
      id: 'cap-1',
      method: 'GET',
      url: 'https://example.com/api/users/123',
      headers: {},
      source: 'tool',
    })

    const { __sessions } = await import('../../src/http/session-manager') as any
    __sessions.set('user:https://example.com', {
      name: 'user:https://example.com',
      baseUrl: 'https://example.com',
      token: 'user-tok',
      cookies: {},
    })

    const { httpRequest } = await import('../../src/tools/http-tools')
    const originalExecute = httpRequest.execute
    let capturedUrl = ''
    let capturedMethod = ''
    httpRequest.execute = vi.fn(async (input: any) => {
      capturedUrl = input.url
      capturedMethod = input.method
      return { ok: true, value: { status: 200, headers: {}, body: '', durationMs: 10 } }
    }) as any

    try {
      const result = await requestAsActorTool.execute!({
        capturedRequestId: 'cap-1',
        actorId: 'user:https://example.com',
        url: 'https://example.com/api/users/456',
        method: 'DELETE',
      } as any, {} as any)

      expect(result.ok).toBe(true)
      expect(capturedUrl).toBe('https://example.com/api/users/456')
      expect(capturedMethod).toBe('DELETE')
    } finally {
      httpRequest.execute = originalExecute
    }
  })
})
