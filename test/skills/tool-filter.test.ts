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
let resolveToolsForSkillsWorker: typeof import('../../src/solver/skills/tool-filter').resolveToolsForSkillsWorker
let getWorkerUniversal: typeof import('../../src/solver/skills/tool-filter').getWorkerUniversal

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../../src/solver/skills/tool-filter')
  resolveToolsForSkills = mod.resolveToolsForSkills
  getCoreTools = mod.getCoreTools
  getExecutionTools = mod.getExecutionTools
  resolveToolsForSkillsWorker = mod.resolveToolsForSkillsWorker
  getWorkerUniversal = mod.getWorkerUniversal
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

  it('includes discovery tools listSkills and loadSkillBody', () => {
    const core = getCoreTools()
    expect(core).toContain('listSkills')
    expect(core).toContain('loadSkillBody')
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

// ─── Phase 2: Worker tool surface reduction ────────────────────────────────

describe('resolveToolsForSkillsWorker', () => {
  it('returns WORKER_UNIVERSAL + skill toolRefs (no planner tools)', () => {
    const workerTools = resolveToolsForSkillsWorker(['authorization'])
    const coreTools = resolveToolsForSkills(['authorization'])

    // Worker should be a strict subset of core (no extra tools)
    for (const tool of workerTools) {
      expect(coreTools).toContain(tool)
    }

    // Worker should be significantly smaller
    expect(workerTools.length).toBeLessThan(coreTools.length)
  })

  it('includes WORKER_UNIVERSAL for any skill', () => {
    const universal = getWorkerUniversal()
    const workerTools = resolveToolsForSkillsWorker(['recon'])
    for (const tool of universal) {
      expect(workerTools).toContain(tool)
    }
  })

  it('excludes planner discovery tools', () => {
    const workerTools = resolveToolsForSkillsWorker(['authorization'])
    expect(workerTools).not.toContain('listSkills')
    expect(workerTools).not.toContain('searchSkills')
    expect(workerTools).not.toContain('manageSkills')
    expect(workerTools).not.toContain('loadSkillBody')
    expect(workerTools).not.toContain('loadSkillReference')
  })

  it('excludes session plumbing tools', () => {
    const workerTools = resolveToolsForSkillsWorker(['authorization'])
    expect(workerTools).not.toContain('saveSession')
    expect(workerTools).not.toContain('restoreSession')
    expect(workerTools).not.toContain('storeSession')
    expect(workerTools).not.toContain('useSession')
  })

  it('excludes graph analysis tools', () => {
    const workerTools = resolveToolsForSkillsWorker(['authorization'])
    expect(workerTools).not.toContain('getGraphSchema')
    expect(workerTools).not.toContain('getCaptureOverview')
    expect(workerTools).not.toContain('queryRelations')
    expect(workerTools).not.toContain('getGraphNeighborhood')
    expect(workerTools).not.toContain('getWorkflowAround')
    expect(workerTools).not.toContain('traceValue')
    expect(workerTools).not.toContain('explainReachability')
    expect(workerTools).not.toContain('getUntestedWorkarounds')
    expect(workerTools).not.toContain('verifyChains')
  })

  it('excludes bookkeeping tools', () => {
    const workerTools = resolveToolsForSkillsWorker(['authorization'])
    expect(workerTools).not.toContain('getDialogEvidence')
    expect(workerTools).not.toContain('getRecentChanges')
    expect(workerTools).not.toContain('getResearchStatus')
  })

  it('excludes recordEvidence from worker universal (httpRequest auto-captures)', () => {
    const universal = getWorkerUniversal()
    // recordEvidence is NOT in WORKER_UNIVERSAL — httpRequest auto-captures evidence.
    // Skills that need manual evidence attachment declare it in toolRefs.
    expect(universal).not.toContain('recordEvidence')
  })

  it('includes skill-declared tools (e.g. httpRequest for authorization)', () => {
    const workerTools = resolveToolsForSkillsWorker(['authorization'])
    expect(workerTools).toContain('httpRequest')
    expect(workerTools).toContain('parseResponse')
    expect(workerTools).toContain('writeFinding')
    expect(workerTools).toContain('runPrimitive')
  })

  it('web-pentest worker gets extractSessionCookie from toolRefs', () => {
    const workerTools = resolveToolsForSkillsWorker(['web-pentest'])
    expect(workerTools).toContain('extractSessionCookie')
  })

  it('fails closed for unknown skill IDs', () => {
    expect(() => resolveToolsForSkillsWorker(['does-not-exist'])).toThrow('Skill not found')
  })

  it('returns WORKER_UNIVERSAL count when no skills specified', () => {
    const tools = resolveToolsForSkillsWorker([])
    expect(tools.length).toBe(getWorkerUniversal().length)
    expect(new Set(tools).size).toBe(tools.length)
  })

  it('deduplicates tools from multiple skills', () => {
    const tools = resolveToolsForSkillsWorker(['authorization', 'api-security'])
    expect(new Set(tools).size).toBe(tools.length)
  })

  it('worker surface is at least 50% smaller than brain surface', () => {
    const workerTools = resolveToolsForSkillsWorker(['authorization'])
    const brainTools = resolveToolsForSkills(['authorization'])
    const reduction = 1 - workerTools.length / brainTools.length
    expect(reduction).toBeGreaterThanOrEqual(0.5)
  })
})
