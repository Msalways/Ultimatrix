import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/safety/scope-guard', () => ({
  isUrlInScope: vi.fn().mockReturnValue({ allowed: true }),
}))

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    resolve4 = vi.fn().mockRejectedValue(new Error('NXDOMAIN'))
  },
}))

vi.stubGlobal('fetch', vi.fn())

let resolveToolsForSkills: typeof import('../../src/solver/skills/tool-filter').resolveToolsForSkills
let getCoreTools: typeof import('../../src/solver/skills/tool-filter').getCoreTools
let getExecutionTools: typeof import('../../src/solver/skills/tool-filter').getExecutionTools

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../../src/solver/skills/tool-filter')
  resolveToolsForSkills = mod.resolveToolsForSkills
  getCoreTools = mod.getCoreTools
  getExecutionTools = mod.getExecutionTools
})

describe('resolveToolsForSkills', () => {
  it('merges CORE_TOOLS with skill toolRefs', () => {
    const tools = resolveToolsForSkills(['recon'])
    expect(tools).toContain('writeFinding')
    expect(tools).toContain('httpRequest')
    expect(tools).toContain('runRecon')
  })

  it('fails closed for unknown skill IDs', () => {
    expect(() => resolveToolsForSkills(['does-not-exist'])).toThrow('Skill not found: does-not-exist')
  })

  it('returns CORE_TOOLS count when no skills specified', () => {
    const tools = resolveToolsForSkills([])
    // No skills → exactly the CORE_TOOLS set (deduped).
    expect(tools.length).toBe(getCoreTools().length)
    expect(new Set(tools).size).toBe(tools.length)
  })

  it('CORE_TOOLS always include held-session reuse tools (W2 cross-cut)', () => {
    const tools = resolveToolsForSkills([])
    expect(tools).toContain('useSession')
    expect(tools).toContain('extractSessionCookie')
  })

  it('deduplicates tools from multiple skills', () => {
    const toolsA = resolveToolsForSkills(['recon'])
    const toolsB = resolveToolsForSkills(['recon', 'vuln-discovery'])
    expect(toolsB.length).toBeGreaterThanOrEqual(toolsA.length)
    const unique = new Set(toolsB)
    expect(unique.size).toBe(toolsB.length)
  })
})

describe('CORE_TOOLS includes only invariant tools', () => {
  it('includes getOastUrlTool (registry key, not getOastUrl)', () => {
    expect(getCoreTools()).toContain('getOastUrlTool')
    expect(getCoreTools()).not.toContain('getOastUrl')
  })

  it('includes discovery tools listTools and loadTool', () => {
    const core = getCoreTools()
    expect(core).toContain('listTools')
    expect(core).toContain('loadTool')
  })

  it('does not expose execution tools without an active skill', () => {
    const core = getCoreTools()
    for (const tool of getExecutionTools()) {
      expect(core).not.toContain(tool)
    }
  })

  it('active skills still grant declared execution tools', () => {
    const tools = resolveToolsForSkills(['recon'])
    expect(tools).toContain('runRecon')
    expect(tools).toContain('writeFinding')
  })
})

describe('CORE_TOOLS does NOT include stale tools', () => {
  it('does not include updateGraph', () => {
    expect(getCoreTools()).not.toContain('updateGraph')
  })

  it('does not include readReport', () => {
    expect(getCoreTools()).not.toContain('readReport')
  })

  it('does not include old graph manipulation methods', () => {
    const core = getCoreTools()
    expect(core).not.toContain('updateNode')
    expect(core).not.toContain('deleteNode')
    expect(core).not.toContain('readGraph')
  })
})
