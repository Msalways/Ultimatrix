import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

vi.mock('../../src/http/session-manager', () => ({
  getGlobalSessionManager: () => globalThis.__sm,
}))
vi.mock('../../src/safety/scope-guard', () => ({
  isUrlInScope: (url: string) => ({ allowed: url.startsWith('https://in-scope'), reason: url.startsWith('https://in-scope') ? undefined : 'out' }),
}))
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => globalThis.__store,
}))
vi.mock('../../src/intelligence/rbac-learner', async (importOriginal: any) => {
  const mod = await importOriginal()
  return { ...mod, learnRBACFromMatrix: (m: any) => { globalThis.__learned = m; return [] } }
})

import { dualSessionOrchestrator } from '../../src/tools/dual-session'

function makeSessionManager() {
  const sessions = new Map<string, any>()
  const clients = new Map<string, any>()
  return {
    createSession: (n: string, u: string) => { const s = { name: n, baseUrl: u, cookies: {}, token: null }; sessions.set(n, s); clients.set(n, { setCookie: () => {} }); return s },
    getSession: (n: string) => sessions.get(n),
    getClient: (n: string) => clients.get(n),
    getAllHeaders: (n: string) => ({ Authorization: `Bearer ${n}` }),
    setToken: () => {},
  }
}

describe('dualSessionOrchestrator', () => {
  beforeEach(() => {
    globalThis.__sm = makeSessionManager()
    globalThis.__learned = undefined
  })

  it('builds a normalized matrix from a declarative role', async () => {
    const res: any = await (dualSessionOrchestrator as any).execute({
      matrix: [{ role: 'admin', baseUrl: 'https://in-scope/x', headers: { Authorization: 'Bearer adm' }, ownedObjectIds: ['obj-1'], reachableEndpoints: ['https://in-scope/api/users'], marker: 'ADMIN-UNIQUE' }],
      writeToGraph: true,
    })
    expect(res.ok).toBe(true)
    expect(res.roleCount).toBe(1)
    expect(res.roles[0].role).toBe('admin')
    expect(res.roles[0].headers['Authorization']).toBe('Bearer adm')
    expect(res.roles[0].ownedObjectIds).toContain('obj-1')
    expect(globalThis.__learned).toBeDefined()
    expect(globalThis.__learned[0].role).toBe('admin')
  })

  it('rejects out-of-scope roles via scope guard', async () => {
    const res: any = await (dualSessionOrchestrator as any).execute({
      matrix: [{ role: 'evil', baseUrl: 'https://evil.example.com', headers: {} }],
    })
    expect(res.ok).toBe(false)
    expect(res.scopeViolations.length).toBe(1)
    expect(res.roleCount).toBe(0)
  })

  it('folds cookies into a Cookie header', async () => {
    const res: any = await (dualSessionOrchestrator as any).execute({
      matrix: [{ role: 'u', baseUrl: 'https://in-scope/y', cookies: { sid: 'abc' } }],
      writeToGraph: false,
    })
    expect(res.roles[0].headers['Cookie']).toBe('sid=abc')
  })
})
