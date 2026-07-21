import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), dim: vi.fn() },
}))

const mockPage = {
  act: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/browser/manager', () => ({
  getActivePage: () => mockPage,
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
  return useCredential.execute({ context: args }, {} as any)
}

describe('useCredential tool', () => {
  beforeEach(() => {
    mockPage.act.mockClear()
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

  it('login fills form out-of-band via page.act and returns masked confirmation', async () => {
    const res = await callTool({ action: 'login', role: 'admin' })
    expect(res.ok).toBe(true)
    expect(mockPage.act).toHaveBeenCalledWith(expect.stringContaining('s3cr3t-p@ss'))
    expect(res.message).not.toContain('s3cr3t-p@ss')
    expect(res.maskedPassword).not.toBe('s3cr3t-p@ss')
  })

  it('list with no configured credentials reports empty', async () => {
    vi.resetModules()
    vi.doMock('../../src/config', () => ({ getConfig: () => ({ credentials: {} }) }))
    const { useCredential } = await import('../../src/tools/credential-tools')
    const res = await useCredential.execute({ context: { action: 'list' } }, {} as any)
    expect(res.ok).toBe(false)
    expect(res.roles).toEqual([])
    vi.doMock('../../src/config', () => ({ getConfig: () => mockConfig }))
  })
})
