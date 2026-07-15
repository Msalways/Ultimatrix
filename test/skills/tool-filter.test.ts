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
let resolveSkillsForInput: typeof import('../../src/solver/skills/tool-filter').resolveSkillsForInput
let getCoreTools: typeof import('../../src/solver/skills/tool-filter').getCoreTools

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../../src/solver/skills/tool-filter')
  resolveToolsForSkills = mod.resolveToolsForSkills
  resolveSkillsForInput = mod.resolveSkillsForInput
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
    expect(tools.length).toBe(37)
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

describe('resolveSkillsForInput', () => {
  it('matches relevant skills for SQL injection query', () => {
    const skills = resolveSkillsForInput('find SQL injection vulnerabilities in login form')
    expect(skills.length).toBeGreaterThan(0)
    const ids = skills.map(s => s.id)
    expect(ids.some(id => id.includes('sql') || id.includes('injection') || id.includes('vuln'))).toBe(true)
  })

  it('matches recon skill for reconnaissance query', () => {
    const skills = resolveSkillsForInput('perform reconnaissance on target domain')
    expect(skills.length).toBeGreaterThan(0)
    const ids = skills.map(s => s.id)
    expect(ids).toContain('recon')
  })

  it('returns empty for no-match input', () => {
    const skills = resolveSkillsForInput('zzz no skill matches this gibberish 12345')
    expect(skills.length).toBe(0)
  })

  it('returns at most 3 results', () => {
    const skills = resolveSkillsForInput('SQL injection XSS vulnerability exploitation authentication bypass')
    expect(skills.length).toBeLessThanOrEqual(3)
  })

  it('penalizes excluded skills (negative scoring)', () => {
    const includeSkills = resolveSkillsForInput('SQL injection vulnerability')
    const excludeSkills = resolveSkillsForInput('SQL injection vulnerability not for SQL injection')
    if (includeSkills.length > 0 && excludeSkills.length > 0) {
      const includeIds = includeSkills.map(s => s.id)
      const excludeIds = excludeSkills.map(s => s.id)
      const topIncluded = includeIds[0]
      if (excludeIds.includes(topIncluded)) {
        const includeRank = excludeIds.indexOf(topIncluded)
        const nonExcludeRank = excludeIds.findIndex(id => id !== topIncluded)
        if (nonExcludeRank >= 0) {
          expect(includeRank).toBeGreaterThan(nonExcludeRank)
        }
      }
    }
  })

  it('matches modern-xss skill for dom xss queries', () => {
    const skills = resolveSkillsForInput('test for dom xss exploitation client side attack')
    expect(skills.length).toBeGreaterThan(0)
    const ids = skills.map(s => s.id)
    expect(ids.some(id => id.includes('xss'))).toBe(true)
  })
})
