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

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../../src/solver/skills/tool-filter')
  resolveToolsForSkills = mod.resolveToolsForSkills
  getCoreTools = mod.getCoreTools
})

describe('resolveToolsForSkills', () => {
  it('merges CORE_TOOLS with skill toolRefs', () => {
    const tools = resolveToolsForSkills(['recon'])
    expect(tools).toContain('writeFinding')
    expect(tools).toContain('httpRequest')
    expect(tools).toContain('runRecon')
  })

  it('returns CORE_TOOLS count when no skills specified', () => {
    const tools = resolveToolsForSkills([])
    // 37 historical core tools + listTools + loadTool discovery tools.
    expect(tools.length).toBe(39)
  })

  it('deduplicates tools from multiple skills', () => {
    const toolsA = resolveToolsForSkills(['recon'])
    const toolsB = resolveToolsForSkills(['recon', 'vuln-discovery'])
    expect(toolsB.length).toBeGreaterThanOrEqual(toolsA.length)
    const unique = new Set(toolsB)
    expect(unique.size).toBe(toolsB.length)
  })
})

describe('CORE_TOOLS includes new tools', () => {
  it('includes runPrimitive', () => {
    expect(getCoreTools()).toContain('runPrimitive')
  })

  it('includes getOastUrlTool (registry key, not getOastUrl)', () => {
    expect(getCoreTools()).toContain('getOastUrlTool')
    expect(getCoreTools()).not.toContain('getOastUrl')
  })

  it('includes recordOutcome', () => {
    expect(getCoreTools()).toContain('recordOutcome')
  })

  it('includes runCampaign', () => {
    expect(getCoreTools()).toContain('runCampaign')
  })

  it('includes discovery tools listTools and loadTool', () => {
    const core = getCoreTools()
    expect(core).toContain('listTools')
    expect(core).toContain('loadTool')
  })

  it('includes runRecon and recon tools', () => {
    const core = getCoreTools()
    expect(core).toContain('runRecon')
    expect(core).toContain('graphqlIntrospect')
    expect(core).toContain('jwtDecode')
    expect(core).toContain('frameworkFingerprint')
    expect(core).toContain('cloudMetadataProbe')
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
