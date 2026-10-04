import { describe, expect, it, vi } from 'vitest'

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
vi.mock('../../src/capture/human-observer', () => ({ getGlobalObserver: () => ({ getAuthDetector: () => ({ detectAuthState: async () => ({}) }) }) }))
vi.mock('../../src/graph/tool-result-store', () => ({ getToolResultStore: () => ({ get: () => null }) }))
vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => ({}) }))

import { createSolverBrain } from '../../src/solver/brain-tools'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'

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
      }),
    } as any,
  })
  return { brain, extensionRegistry }
}

describe('solver brain lazy tool view', () => {
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
