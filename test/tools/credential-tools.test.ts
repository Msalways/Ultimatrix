import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), dim: vi.fn() },
}))

const mockField = {
  fill: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  press: vi.fn().mockResolvedValue(undefined),
  count: vi.fn().mockResolvedValue(1),
  first: vi.fn(),
}
mockField.first.mockReturnValue(mockField)

const mockPage = {
  act: vi.fn().mockResolvedValue(undefined),
  locator: vi.fn(() => mockField),
  url: vi.fn().mockReturnValue('https://target.local/app'),
  evaluate: vi.fn().mockResolvedValue({}),
}

vi.mock('../../src/browser/manager', () => ({
  getActivePage: () => mockPage,
  getActiveBrowser: () => null,
  getActiveCamofoxSession: () => null,
  getActiveBrowserContext: () => ({
    cookies: vi.fn().mockResolvedValue([
      { name: 'sess', value: 'abc' },
    ]),
  }),
}))

const mockConfig = {
  credentials: {
    admin: { email: 'admin@target.local', password: 's3cr3t-p@ss' },
    user: { email: 'user@target.local', password: 'hunter2-pass' },
  },
}

vi.mock('../../src/config', () => ({
  getConfig: () => mockConfig,
}))

async function callTool(args: any) {
  const { useCredential } = await import('../../src/tools/credential-tools')
  return useCredential.execute(args, {} as any)
}

describe('useCredential tool', () => {
  beforeEach(() => {
    mockPage.act.mockClear()
    mockField.fill.mockClear()
    mockField.click.mockClear()
    mockField.press.mockClear()
  })

  it('list returns only role names, no secrets', async () => {
    const res = await callTool({ action: 'list' })
    expect(res.ok).toBe(true)
    expect(res.roles).toEqual(['admin', 'user'])
    expect(res.message).not.toContain('s3cr3t')
    expect(res.message).not.toContain('hunter2')
  })

  it('reveal returns masked password, never plaintext', async () => {
    const res = await callTool({ action: 'reveal', role: 'admin' })
    expect(res.ok).toBe(true)
    expect(res.email).toBe('admin@target.local')
    expect(res.maskedPassword).not.toBe('s3cr3t-p@ss')
    expect(res.maskedPassword).toMatch(/^\w{4}\*+/)
    expect(res.message).not.toContain('s3cr3t-p@ss')
  })

  it('reveal for unknown role fails with available roles', async () => {
    const res = await callTool({ action: 'reveal', role: 'ghost' })
    expect(res.ok).toBe(false)
    expect(res.roles).toEqual(['admin', 'user'])
  })

  it('login fills credentials through native locators without putting the password in a model action', async () => {
    const res = await callTool({ action: 'login', role: 'admin' })
    expect(res.ok).toBe(true)
    expect(mockField.fill).toHaveBeenCalledWith('admin@target.local', expect.anything())
    expect(mockField.fill).toHaveBeenCalledWith('s3cr3t-p@ss', expect.anything())
    expect(mockPage.act).not.toHaveBeenCalled()
    expect(res.message).not.toContain('s3cr3t-p@ss')
    expect(res.maskedPassword).not.toBe('s3cr3t-p@ss')
  })

  it('list with no configured credentials reports empty', async () => {
    vi.resetModules()
    vi.doMock('../../src/config', () => ({ getConfig: () => ({ credentials: {} }) }))
    const { useCredential } = await import('../../src/tools/credential-tools')
    const res = await useCredential.execute({ action: 'list' }, {} as any)
    expect(res.ok).toBe(false)
    expect(res.roles).toEqual([])
    vi.doMock('../../src/config', () => ({ getConfig: () => mockConfig }))
  })
})

describe('acquireActors tool', () => {
  async function cleanSessions() {
    const { getGlobalSessionManager } = await import('../../src/http/session-manager')
    for (const name of getGlobalSessionManager().listSessions()) {
      getGlobalSessionManager().removeSession(name)
    }
  }

  // The earlier 'no configured credentials' test resets the module registry;
  // re-import credential-tools against the standard mock config so these
  // tests observe two configured roles regardless of file order.
  async function freshAcquireActors() {
    vi.resetModules()
    vi.doMock('../../src/config', () => ({ getConfig: () => mockConfig }))
    return (await import('../../src/tools/credential-tools')).acquireActors
  }

  it('logs in all configured roles and inventories the actor sessions', async () => {
    await cleanSessions()
    try {
      const acquireActors = await freshAcquireActors()
      const res = await acquireActors.execute({}, {} as any)
      expect(res.ok).toBe(true)
      expect(res.acquired.map((a: any) => a.role).sort()).toEqual(['admin', 'user'])
      expect(res.failed).toEqual([])
      const names = res.actors.map((a: any) => a.name)
      expect(names).toContain('admin:https://target.local')
      expect(names).toContain('user:https://target.local')
    } finally {
      await cleanSessions()
    }
  })

  it('acquires only the requested subset', async () => {
    await cleanSessions()
    try {
      const acquireActors = await freshAcquireActors()
      const res = await acquireActors.execute({ roles: ['admin'] }, {} as any)
      expect(res.ok).toBe(true)
      expect(res.acquired.map((a: any) => a.role)).toEqual(['admin'])
    } finally {
      await cleanSessions()
    }
  })

  it('reports unknown roles without fabricating sessions', async () => {
    await cleanSessions()
    try {
      const acquireActors = await freshAcquireActors()
      const res = await acquireActors.execute({ roles: ['ghost'] }, {} as any)
      expect(res.ok).toBe(false)
      expect(res.unknownRoles).toEqual(['ghost'])
      expect(res.acquired).toEqual([])
      const { getGlobalSessionManager } = await import('../../src/http/session-manager')
      expect(getGlobalSessionManager().listSessions()).toEqual([])
    } finally {
      await cleanSessions()
    }
  })
})
