import { describe, expect, it, vi } from 'vitest'

const { captureState, graphState } = vi.hoisted(() => ({
  captureState: { size: 0, actions: [] as Array<Record<string, unknown>>, nativeActionDuringTool: false },
  graphState: { nodes: [] as Array<{ id: string; type: string; updatedAt: number }> },
}))

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    id = ''
    name = ''
    tools: any
    defaultOptions: any
    constructor(config: any) { this.tools = config.tools; this.defaultOptions = config.defaultOptions }
  },
}))
vi.mock('@mastra/core/processors', () => ({ TokenLimiterProcessor: class {} }))
vi.mock('../../src/models/factory', () => ({ resolveModel: () => ({ model: 'test' }) }))
vi.mock('../../src/models/routing', () => ({ resolveModelRef: () => ({ model: 'test', modelId: 'test' }) }))
vi.mock('../../src/models/context-window-registry', () => ({ ContextWindowRegistry: class { getContextWindow() { return 128_000 } } }))
vi.mock('../../src/models/schema-sanitizer', () => ({ createSanitizedInputSchema: (schema: unknown) => schema }))
vi.mock('../../src/solver/brain-instructions', () => ({ getBrainInstructions: () => 'test' }))
vi.mock('../../src/browser/manager', () => ({ getActivePage: () => null }))
vi.mock('../../src/capture/human-observer', () => ({
  getGlobalObserver: () => ({
    getAuthDetector: () => ({ detectAuthState: async () => ({}) }),
    getActions: () => [...captureState.actions],
    record: (action: Record<string, unknown>) => { captureState.actions.push(action) },
  }),
}))
vi.mock('../../src/graph/tool-result-store', () => ({ getToolResultStore: () => ({ get: () => null }) }))
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({
    queryNodes: (type: string) => graphState.nodes.filter(node => node.type === type),
  }),
}))
vi.mock('../../src/capture/captured-request-store', () => ({
  getCapturedRequestStore: () => ({
    get size() { return captureState.size },
    record: () => undefined,
    list: () => [],
    get: () => null,
    clear: () => { captureState.size = 0 },
  }),
}))

import { createSolverBrain } from '../../src/solver/brain-tools'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'
import { buildResearchMap, planResearchExperiments } from '../../src/tools/research-tools'
import { NodeType } from '../../src/graph/schema'

function setup() {
  const extensionRegistry = new DynamicToolRegistry()
  const brain: any = createSolverBrain({ provider: 'groq', model: 'test', engine: 'solver' } as any, {
    skillRegistry: { list: () => [], search: () => [] } as any,
    extensionRegistry,
    lazyServices: {
      getBrowserTools: async () => ({
        browserInteract: {
          description: 'Interact with one currently visible control.',
          inputSchema: {},
          execute: async () => ({ success: true }),
        },
        stagehand_act: {
          description: 'Perform one action against the current page.',
          inputSchema: {},
          execute: async (input: any) => {
            if (captureState.nativeActionDuringTool) captureState.actions.push({
              type: input.action,
              selector: input.selector,
              url: 'https://example.test/workflow',
              timestamp: Date.now(),
            })
            return { success: true, action: input.action, selector: input.selector, url: 'https://example.test/workflow' }
          },
        },
      }),
    } as any,
  })
  return { brain, extensionRegistry }
}

describe('solver brain lazy tool view', () => {
  it('keeps a map stale when target observations arrive while it is being built', async () => {
    captureState.size = 0
    graphState.nodes = []
    const mapSpy = vi.spyOn(buildResearchMap, 'execute').mockImplementationOnce(async () => {
      captureState.size += 1
      return { ok: true, value: { hypotheses: 1 } } as any
    })
    try {
      const { brain } = setup()
      const tools = brain.tools()
      await expect(tools.buildResearchMap.execute({ maxHypotheses: 12 })).resolves.toMatchObject({
        ok: false,
        code: 'RESEARCH_MAP_STALE',
      })
      await expect(tools.planResearchExperiments.execute({ maxExperiments: 6 })).resolves.toMatchObject({
        ok: false,
        code: 'RESEARCH_MAP_STALE',
      })
    } finally {
      mapSpy.mockRestore()
    }
  })

  it('records solver browser actions without storing filled values', async () => {
    captureState.actions = []
    captureState.nativeActionDuringTool = false
    const { brain, extensionRegistry } = setup()
    brain.setMethodologyState({ methodologyLoaded: true, researchMapBuilt: true, experimentPlanned: true })
    await extensionRegistry.activate('stagehand_act')
    const tools = brain.tools()

    await tools.stagehand_act.execute({ action: 'fill', selector: 'input[name="offer"]', value: 'private-value' })

    expect(captureState.actions).toEqual([expect.objectContaining({
      type: 'fill',
      selector: 'input[name="offer"]',
      url: 'https://example.test/workflow',
      metadata: { source: 'solver-browser-tool' },
    })])
    expect(JSON.stringify(captureState.actions)).not.toContain('private-value')
  })

  it('does not duplicate browser actions already captured during the tool call', async () => {
    captureState.actions = []
    captureState.nativeActionDuringTool = true
    const { brain, extensionRegistry } = setup()
    brain.setMethodologyState({ methodologyLoaded: true, researchMapBuilt: true, experimentPlanned: true })
    await extensionRegistry.activate('stagehand_act')

    await brain.tools().stagehand_act.execute({ action: 'fill', selector: 'input[name="offer"]', value: 'private-value' })

    expect(captureState.actions).toHaveLength(1)
    expect(JSON.stringify(captureState.actions)).not.toContain('private-value')
    captureState.nativeActionDuringTool = false
  })

  it('does not mistake workflow persistence timestamp changes for new observations', async () => {
    captureState.size = 0
    const workflow = {
      id: 'workflow:observed-1',
      type: NodeType.WORKFLOW,
      updatedAt: 1,
      properties: {
        name: 'operator-demonstration',
        entryUrl: 'https://example.test/account',
        steps: [{ action: 'click', url: 'https://example.test/account', selector: '#save' }],
        relatedEndpoints: [],
        inputFields: ['#save'],
        stateChanges: [],
        observedRoles: [],
        confidence: 1,
        source: 'operator-demonstration',
        sequenceObserved: false,
        capturedRequestIds: [],
        capturedAt: 1,
      },
    }
    graphState.nodes = [workflow]
    const mapSpy = vi.spyOn(buildResearchMap, 'execute').mockImplementationOnce(async () => {
      workflow.updatedAt += 1
      return { ok: true, value: { hypotheses: 1 } } as any
    })
    const planSpy = vi.spyOn(planResearchExperiments, 'execute').mockResolvedValue({ ok: true, value: { experimentsPlanned: 1 } } as any)
    try {
      const { brain } = setup()
      const tools = brain.tools()
      await expect(tools.buildResearchMap.execute({ maxHypotheses: 12 })).resolves.toMatchObject({ ok: true })
      await expect(tools.planResearchExperiments.execute({ maxExperiments: 6 })).resolves.toMatchObject({ ok: true })
      expect(planSpy).toHaveBeenCalledTimes(1)
    } finally {
      mapSpy.mockRestore()
      planSpy.mockRestore()
    }
  })

  it('refreshes cached research setup when captured target traffic changes', async () => {
    captureState.size = 0
    graphState.nodes = []
    const mapSpy = vi.spyOn(buildResearchMap, 'execute').mockResolvedValue({ ok: true, value: { hypotheses: 1 } } as any)
    const planSpy = vi.spyOn(planResearchExperiments, 'execute').mockResolvedValue({ ok: true, value: { experimentsPlanned: 1 } } as any)
    try {
      const { brain, extensionRegistry } = setup()
      await extensionRegistry.activate('runPrimitive')
      const tools = brain.tools()
      await tools.buildResearchMap.execute({ maxHypotheses: 12 })
      await tools.buildResearchMap.execute({ maxHypotheses: 12 })
      expect(mapSpy).toHaveBeenCalledTimes(1)

      await tools.planResearchExperiments.execute({ maxExperiments: 6 })
      await tools.planResearchExperiments.execute({ maxExperiments: 6 })
      expect(planSpy).toHaveBeenCalledTimes(1)
      brain.setMethodologyState({ methodologyLoaded: true, researchMapBuilt: true, experimentPlanned: true })

      captureState.size += 1
      await expect(tools.planResearchExperiments.execute({ maxExperiments: 6 })).resolves.toMatchObject({
        ok: false,
        code: 'RESEARCH_MAP_STALE',
      })
      await expect(tools.executePlannedExperiment.execute({ experimentId: 'experiment-1' })).resolves.toMatchObject({
        ok: false,
        code: 'RESEARCH_MAP_STALE',
      })
      await expect(tools.runPrimitive.execute({ primitiveId: 'businessLogicAbuse', context: {} })).resolves.toMatchObject({
        ok: false,
        code: 'RESEARCH_MAP_STALE',
      })

      await tools.buildResearchMap.execute({ maxHypotheses: 12 })
      await tools.planResearchExperiments.execute({ maxExperiments: 6 })
      expect(mapSpy).toHaveBeenCalledTimes(2)
      expect(planSpy).toHaveBeenCalledTimes(2)

      graphState.nodes.push({ id: 'endpoint-1', type: NodeType.ENDPOINT, updatedAt: 1 })
      await expect(tools.runPrimitive.execute({ primitiveId: 'businessLogicAbuse', context: {} })).resolves.toMatchObject({
        ok: false,
        code: 'RESEARCH_MAP_STALE',
      })
      await tools.buildResearchMap.execute({ maxHypotheses: 12 })
      await tools.planResearchExperiments.execute({ maxExperiments: 6 })
      expect(mapSpy).toHaveBeenCalledTimes(3)
      expect(planSpy).toHaveBeenCalledTimes(3)
    } finally {
      mapSpy.mockRestore()
      planSpy.mockRestore()
    }
  })

  it('starts with control-plane tools plus catalog discovery', () => {
    const { brain } = setup()
    expect(Object.keys(brain.tools())).toEqual(expect.arrayContaining([
      'listTools', 'loadTool', 'getTargetSummary', 'queryGraph', 'getGraphSchema',
      'getWorkflowAround', 'getSessionContext', 'getCaptureOverview',
      'webSearch', 'buildResearchMap', 'planResearchExperiments',
      'compareResearchResponses', 'evaluateResearchExperiment',
      'recordFindingCandidate', 'assessCandidateReportability', 'getResearchStatus',
      'listSkills', 'searchSkills', 'discoverSkillsForTarget',
      'loadSkillReference', 'loadSkillBody',
    ]))
    expect(brain.defaultOptions.activeTools).toEqual(expect.arrayContaining([
      'listTools', 'loadTool', 'getTargetSummary', 'webSearch',
      'buildResearchMap', 'planResearchExperiments',
      'searchSkills', 'discoverSkillsForTarget', 'loadSkillBody',
    ]))
    // Gated schemas stay stable across Mastra steps; execution returns a typed
    // METHODOLOGY_REQUIRED result until the research prerequisites are met.
    expect(brain.defaultOptions.activeTools).toContain('httpRequest')
    expect(brain.defaultOptions.activeTools).toContain('stagehand_navigate')
  })

  it('refreshes the native toolset after activation', async () => {
    const { brain, extensionRegistry } = setup()
    await extensionRegistry.activate('queryGraph')
    const step = brain.defaultOptions.prepareStep()
    expect(step.activeTools).toContain('queryGraph')
    expect(step.tools.queryGraph).toBeDefined()
  })

  it('discovers provider-neutral browser interaction dynamically and gates it until a plan exists', async () => {
    const { extensionRegistry } = setup()
    const descriptor = await extensionRegistry.describe('browserInteract')

    expect(descriptor).toMatchObject({
      id: 'browserInteract',
      namespace: 'browser',
      activity: 'browser-action',
      readOnly: false,
    })
    expect(descriptor?.description).toMatch(/latest page inspection/i)

    const tool = await extensionRegistry.activate('browserInteract')
    expect(tool.description).toMatch(/requires methodology setup/i)
    await expect(tool.execute({ action: 'click' } as any)).resolves.toMatchObject({
      ok: false,
      code: 'METHODOLOGY_REQUIRED',
    })
  })

  it('does not expose an invocation gateway', () => {
    const { brain } = setup()
    expect(Object.keys(brain.tools())).not.toContain('invokeTool')
  })

  it('allows passive baseline observation before methodology is loaded', async () => {
    const { brain } = setup()
    const tools = brain.tools()
    const getResult = await tools.httpRequest.execute({ method: 'GET', url: 'https://example.com' })
    const postResult = await tools.httpRequest.execute({ method: 'POST', url: 'https://example.com', body: {} })
    expect(getResult?.code).not.toBe('METHODOLOGY_REQUIRED')
    expect(postResult?.code).toBe('METHODOLOGY_REQUIRED')
  })

})
