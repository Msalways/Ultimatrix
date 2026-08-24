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
  })
  return { brain, extensionRegistry }
}

describe('solver brain lazy tool view', () => {
  it('starts with only catalog discovery and exact loading', () => {
    const { brain } = setup()
    expect(Object.keys(brain.tools())).toEqual(['listTools', 'loadTool'])
    expect(brain.defaultOptions.activeTools).toEqual(['listTools', 'loadTool'])
  })

  it('refreshes the native toolset after activation', async () => {
    const { brain, extensionRegistry } = setup()
    await extensionRegistry.activate('queryGraph')
    const step = brain.defaultOptions.prepareStep()
    expect(step.activeTools).toContain('queryGraph')
    expect(step.tools.queryGraph).toBeDefined()
  })

  it('does not expose an invocation gateway', () => {
    const { brain } = setup()
    expect(Object.keys(brain.tools())).not.toContain('invokeTool')
  })
})
