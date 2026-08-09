import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildAdapterTool } from '../../src/tools/scanner-tools'
import { ALL_ADAPTERS } from '../../src/tools/adapters'
import { setExternalToolsConfig, setScopeConfig, setAllowAny } from '../../src/safety/scope-guard'

const { isToolAvailableMock, runBinaryMock } = vi.hoisted(() => ({
  isToolAvailableMock: vi.fn(async () => true),
  runBinaryMock: vi.fn(async () => ({ stdout: '', stderr: '', timedOut: false })),
}))

vi.mock('../../src/tools/adapters/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/adapters/common')>()
  return {
    ...actual,
    isToolAvailable: isToolAvailableMock,
    runBinary: runBinaryMock,
  }
})

const nuclei = ALL_ADAPTERS.find((a) => a.id === 'nuclei')!
const sqlmap = ALL_ADAPTERS.find((a) => a.id === 'sqlmap')!

function resetAmbient(): void {
  setScopeConfig(null)
  setExternalToolsConfig(null)
  setAllowAny(true) // suite default (test/setup.ts)
}

describe('buildAdapterTool external-tool gate', () => {
  beforeEach(() => {
    isToolAvailableMock.mockReturnValue(true)
    runBinaryMock.mockReset()
    runBinaryMock.mockReturnValue({ stdout: '', stderr: '', timedOut: false })
    resetAmbient()
  })
  afterEach(resetAmbient)

  it('denies execution by default (external tools disabled)', async () => {
    const result = await buildAdapterTool(nuclei).execute({ target: 'https://example.com' })
    expect(result.status).toBe('denied')
    expect(runBinaryMock).not.toHaveBeenCalled()
  })

  it('denies execution even under allow-any (opt-in is separate from URL scope)', async () => {
    setAllowAny(true)
    const result = await buildAdapterTool(nuclei).execute({ target: 'https://example.com' })
    expect(result.status).toBe('denied')
  })

  it('executes when externalTools.enabled is set (no per-tool narrowing)', async () => {
    setExternalToolsConfig({ enabled: true })
    const result = await buildAdapterTool(nuclei).execute({ target: 'https://example.com' })
    expect(result.status).toBe('success')
    expect(runBinaryMock).toHaveBeenCalled()
  })

  it('respects per-tool narrowing (sqlmap denied when only nuclei enabled)', async () => {
    setExternalToolsConfig({ enabled: true, tools: { nuclei: true } })
    const denied = await buildAdapterTool(sqlmap).execute({ target: 'https://example.com' })
    expect(denied.status).toBe('denied')
    const allowed = await buildAdapterTool(nuclei).execute({ target: 'https://example.com' })
    expect(allowed.status).toBe('success')
  })

  it('requires the whitelist to include external_tool when allowedCategories is configured', async () => {
    setExternalToolsConfig({ enabled: true, tools: { nuclei: true } })
    setScopeConfig({ allowedDomains: ['example.com'], allowedCategories: ['read'], enforcement: 'hard' })
    const result = await buildAdapterTool(nuclei).execute({ target: 'https://example.com' })
    expect(result.status).toBe('denied')
  })
})
