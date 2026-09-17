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

let compileCapabilities: typeof import('../../src/capabilities/compiler').compileCapabilities
let CapabilityFacade: typeof import('../../src/capabilities/facade').CapabilityFacade
let getToolCategory: typeof import('../../src/capabilities/registry').getToolCategory
let isToolAllowedByPolicy: typeof import('../../src/capabilities/registry').isToolAllowedByPolicy
let classifyToolRisk: typeof import('../../src/capabilities/registry').classifyToolRisk
let DEFAULT_COMPILER_POLICY: typeof import('../../src/capabilities/types').DEFAULT_COMPILER_POLICY

beforeEach(async () => {
  vi.clearAllMocks()
  const compiler = await import('../../src/capabilities/compiler')
  const facade = await import('../../src/capabilities/facade')
  const registry = await import('../../src/capabilities/registry')
  const types = await import('../../src/capabilities/types')
  compileCapabilities = compiler.compileCapabilities
  CapabilityFacade = facade.CapabilityFacade
  getToolCategory = registry.getToolCategory
  isToolAllowedByPolicy = registry.isToolAllowedByPolicy
  classifyToolRisk = registry.classifyToolRisk
  DEFAULT_COMPILER_POLICY = types.DEFAULT_COMPILER_POLICY
})

describe('compileCapabilities', () => {
  it('compiles authorization skill with correct tool count', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools.length).toBeLessThan(20)
    expect(result.skill.id).toBe('authorization')
  })

  it('includes worker-universal tools', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.tools).toContain('queryGraph')
    expect(result.tools).toContain('getTargetSummary')
    expect(result.tools).toContain('getEndpointsWithParams')
    expect(result.tools).toContain('getCapturedHeaders')
    expect(result.tools).toContain('encodeDecode')
    expect(result.tools).toContain('askUser')
    expect(result.tools).toContain('getOastUrlTool')
  })

  it('excludes planner discovery tools', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.tools).not.toContain('listSkills')
    expect(result.tools).not.toContain('searchSkills')
    expect(result.tools).not.toContain('manageSkills')
    expect(result.tools).not.toContain('loadSkillBody')
    expect(result.tools).not.toContain('loadSkillReference')
  })

  it('excludes session plumbing tools by default', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.tools).not.toContain('saveSession')
    expect(result.tools).not.toContain('restoreSession')
    expect(result.tools).not.toContain('storeSession')
    expect(result.tools).not.toContain('useSession')
  })

  it('excludes graph analysis tools by default', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.tools).not.toContain('getGraphSchema')
    expect(result.tools).not.toContain('queryRelations')
    expect(result.tools).not.toContain('getCaptureOverview')
  })

  it('includes skill-declared tools (httpRequest, writeFinding, runPrimitive)', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.tools).toContain('httpRequest')
    expect(result.tools).toContain('writeFinding')
    expect(result.tools).toContain('runPrimitive')
  })

  it('compiles primitives from skill declaration', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.primitives).toContain('authBypass')
    expect(result.primitives).toContain('idorSwapper')
    expect(result.primitives).toContain('authzMatrix')
    expect(result.primitives).toContain('tenantIsolation')
    expect(result.primitives.length).toBe(4)
  })

  it('evidence policy defaults to auto-capture only', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.evidencePolicy.autoCapture).toBe(true)
    expect(result.evidencePolicy.manualEvidenceAllowed).toBe(false)
    expect(result.evidencePolicy.requireClaimBeforeWrite).toBe(true)
  })

  it('policy can enable session tools', () => {
    const result = compileCapabilities({
      skillIds: ['web-pentest'],
      policy: { allowSessionTools: true },
    })
    expect(result.tools).toContain('extractSessionCookie')
  })

  it('policy can enable manual evidence', () => {
    const result = compileCapabilities({
      skillIds: ['authorization'],
      policy: { allowManualEvidence: true },
    })
    expect(result.tools).toContain('recordEvidence')
    expect(result.evidencePolicy.manualEvidenceAllowed).toBe(true)
  })

  it('estimates token count', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.estimatedTokens).toBeGreaterThan(0)
    expect(result.estimatedTokens).toBe(result.tools.length * 60)
  })

  it('fails for unknown skill', () => {
    expect(() => compileCapabilities({ skillIds: ['nonexistent'] })).toThrow('Skill not found')
  })

  it('maxTools policy truncates tool list', () => {
    const result = compileCapabilities({
      skillIds: ['authorization'],
      policy: { maxTools: 5 },
    })
    expect(result.tools.length).toBeLessThanOrEqual(5)
  })
})

describe('CapabilityFacade', () => {
  it('wraps compiled set into tool IDs and extras', () => {
    const compiled = compileCapabilities({ skillIds: ['authorization'] })
    const facade = new CapabilityFacade(compiled)

    expect(facade.getToolIds()).toEqual(compiled.tools)
    expect(facade.scopedRunPrimitive).not.toBeNull()
    expect(facade.getExtraTools().runPrimitive).toBeDefined()
  })

  it('hasTool checks membership', () => {
    const compiled = compileCapabilities({ skillIds: ['authorization'] })
    const facade = new CapabilityFacade(compiled)

    expect(facade.hasTool('httpRequest')).toBe(true)
    expect(facade.hasTool('listSkills')).toBe(false)
  })

  it('hasPrimitive checks authorization', () => {
    const compiled = compileCapabilities({ skillIds: ['authorization'] })
    const facade = new CapabilityFacade(compiled)

    expect(facade.hasPrimitive('authBypass')).toBe(true)
    expect(facade.hasPrimitive('classicInjection')).toBe(false)
  })

  it('summary returns readable string', () => {
    const compiled = compileCapabilities({ skillIds: ['authorization'] })
    const facade = new CapabilityFacade(compiled)
    const summary = facade.summary()

    expect(summary).toContain('tools:')
    expect(summary).toContain('primitives:')
    expect(summary).toContain('tokens:')
  })

  it('no primitives → null scopedRunPrimitive', () => {
    const compiled = compileCapabilities({ skillIds: ['reporting'] })
    const facade = new CapabilityFacade(compiled)

    expect(facade.scopedRunPrimitive).toBeNull()
    expect(Object.keys(facade.getExtraTools())).toHaveLength(0)
  })
})

describe('Capability Registry', () => {
  it('classifies known tools correctly', () => {
    expect(getToolCategory('queryGraph')).toBe('worker-universal')
    expect(getToolCategory('listSkills')).toBe('planner-discovery')
    expect(getToolCategory('saveSession')).toBe('session-plumbing')
    expect(getToolCategory('getGraphSchema')).toBe('graph-analysis')
    expect(getToolCategory('writeFinding')).toBe('execution')
    expect(getToolCategory('recordEvidence')).toBe('evidence')
  })

  it('unknown tools default to skill-specific', () => {
    expect(getToolCategory('httpRequest')).toBe('skill-specific')
    expect(getToolCategory('someCustomTool')).toBe('skill-specific')
  })

  it('isToolAllowedByPolicy blocks planner tools by default', () => {
    const policy = { ...DEFAULT_COMPILER_POLICY }
    expect(isToolAllowedByPolicy('listSkills', policy)).toBe(false)
    expect(isToolAllowedByPolicy('saveSession', policy)).toBe(false)
    expect(isToolAllowedByPolicy('getGraphSchema', policy)).toBe(false)
  })

  it('isToolAllowedByPolicy allows worker-universal always', () => {
    const policy = { ...DEFAULT_COMPILER_POLICY }
    expect(isToolAllowedByPolicy('queryGraph', policy)).toBe(true)
    expect(isToolAllowedByPolicy('getTargetSummary', policy)).toBe(true)
  })

  it('policy can enable session tools', () => {
    const policy = { ...DEFAULT_COMPILER_POLICY, allowSessionTools: true }
    expect(isToolAllowedByPolicy('saveSession', policy)).toBe(true)
    expect(isToolAllowedByPolicy('restoreSession', policy)).toBe(true)
  })
})

describe('Skill Contract (Phase B)', () => {
  it('authorization skill now has a contract', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.contract).toBeDefined()
    expect(result.contract!.capabilities).toContain('network.request')
    expect(result.contract!.capabilities).toContain('response.compare')
    expect(result.contract!.capabilities).toContain('session.actor-context')
    expect(result.contract!.capabilities).toContain('primitive.execute')
  })

  it('authorization contract has procedure stages', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.contract).toBeDefined()
    expect(result.contract!.procedure).toHaveLength(5)
    expect(result.contract!.procedure[0].id).toBe('baseline')
    expect(result.contract!.procedure[4].id).toBe('reproduce')
  })

  it('authorization contract has coverage requirements', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.contract).toBeDefined()
    expect(result.contract!.coverage).toHaveLength(4)
    expect(result.contract!.coverage.every(c => c.required)).toBe(true)
  })

  it('authorization contract has output schema', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.contract).toBeDefined()
    expect(result.contract!.output.schema).toBe('AuthorizationConclusion')
  })

  it('compiler produces coverageValidation for authorization', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.coverageValidation).toBeDefined()
    expect(result.coverageValidation!.required).toEqual(['network.request', 'response.compare', 'session.actor-context', 'primitive.execute'])
    expect(result.coverageValidation!.covered.length).toBeGreaterThan(0)
  })

  it('all authorization capabilities are covered by compiled tool surface', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    expect(result.coverageValidation).toBeDefined()
    expect(result.coverageValidation!.complete).toBe(true)
    expect(result.coverageValidation!.uncovered).toHaveLength(0)
  })

  it('coverageValidation maps capabilities to correct tools', () => {
    const result = compileCapabilities({ skillIds: ['authorization'] })
    // network.request → httpRequest (in toolRefs)
    expect(result.tools).toContain('httpRequest')
    // response.compare → compareResponses (in toolChains steps)
    // Note: compareResponses is in toolChains but not toolRefs, so it may not be in compiled tools
    // primitive.execute → runPrimitive (in toolRefs)
    expect(result.tools).toContain('runPrimitive')
  })

  it('skills without contracts have no contract or coverageValidation', () => {
    const result = compileCapabilities({ skillIds: ['recon'] })
    expect(result.contract).toBeUndefined()
    expect(result.coverageValidation).toBeUndefined()
  })

  it(' CapabilityFacade exposes contract', () => {
    const compiled = compileCapabilities({ skillIds: ['authorization'] })
    const facade = new CapabilityFacade(compiled)
    expect(facade.compiled.contract).toBeDefined()
    expect(facade.compiled.coverageValidation).toBeDefined()
  })
})

describe('Risk Classification (Phase C)', () => {
  it('read tools are classified as read risk', () => {
    expect(classifyToolRisk('queryGraph')).toBe('read')
    expect(classifyToolRisk('listSkills')).toBe('read')
    expect(classifyToolRisk('getGraphSchema')).toBe('read')
    expect(classifyToolRisk('getCaptureOverview')).toBe('read')
  })

  it('network tools are classified as network risk', () => {
    expect(classifyToolRisk('httpRequest')).toBe('network')
    expect(classifyToolRisk('followRedirects')).toBe('network')
    expect(classifyToolRisk('crawlTarget')).toBe('network')
  })

  it('mutate tools are classified as mutate risk', () => {
    expect(classifyToolRisk('writeFinding')).toBe('mutate')
    expect(classifyToolRisk('runPrimitive')).toBe('mutate')
    expect(classifyToolRisk('updateGraph')).toBe('mutate')
    expect(classifyToolRisk('saveSession')).toBe('mutate')
    expect(classifyToolRisk('manageSkills')).toBe('mutate')
  })

  it('delegate tools are classified as delegate risk', () => {
    expect(classifyToolRisk('spawnWorker')).toBe('delegate')
    expect(classifyToolRisk('spawnSwarm')).toBe('delegate')
    expect(classifyToolRisk('runCampaign')).toBe('delegate')
    expect(classifyToolRisk('runAdvancedPlaybook')).toBe('delegate')
  })

  it('unknown tools default to network risk (conservative)', () => {
    expect(classifyToolRisk('someCustomTool')).toBe('network')
    expect(classifyToolRisk('unknownAdapter')).toBe('network')
  })
})
