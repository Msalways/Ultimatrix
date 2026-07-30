/**
 * Brain toolset parity: verify createSolverBrain() gains all buildToolPack()
 * base tools (the same set as council) plus brain-specific extras.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@mastra/core/agent', () => ({
  Agent: class { id = ''; name = ''; tools: any; constructor(c: any) { this.tools = c.tools } },
}))
vi.mock('@mastra/core/processors', () => ({
  TokenLimiterProcessor: class { constructor() {} },
}))
vi.mock('../../src/models/factory', () => ({
  resolveModel: () => ({ model: 'test' }),
}))
vi.mock('../../src/models/context-window-registry', () => ({
  ContextWindowRegistry: class { getContextWindow() { return 128_000 } },
}))
vi.mock('../../src/models/schema-sanitizer', () => ({
  createSanitizedInputSchema: (s: any) => s,
}))
vi.mock('../../src/solver/brain-instructions', () => ({
  getBrainInstructions: () => 'test instructions',
}))
vi.mock('../../src/browser/manager', () => ({
  getActivePage: () => null,
}))
vi.mock('../../src/capture/human-observer', () => ({
  getGlobalObserver: () => ({
    getAuthDetector: () => ({ detectAuthState: async () => ({}) }),
  }),
}))
vi.mock('../../src/graph/tool-result-store', () => ({
  getToolResultStore: () => ({ get: () => null }),
}))
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({}),
}))
vi.mock('../../src/extensions/tool-tools', () => ({
  listToolsTool: { id: 'listTools', execute: async () => ({}) },
  loadToolTool: { id: 'loadTool', execute: async () => ({}) },
  getAcquiredToolMap: () => ({}),
}))
vi.mock('../../src/intelligence/cross-engagement', () => ({
  CrossEngagementMemory: class { async load() {} getPriorPatterns() { return { engagementCount: 0 } } },
}))

import { createSolverBrain } from '../../src/solver/brain-tools'
import { buildToolPack } from '../../src/core/toolpack'

function makeConfig() {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    target: 'https://test.example.com',
    engine: 'multi-model' as const,
  } as any
}

function makeOptions() {
  return {
    skillRegistry: { search: () => [], list: () => [], get: () => ({ id: 'test' }), has: () => true, count: () => 1 } as any,
    workerPool: { dispatchSlices: async () => [] } as any,
    browser: undefined,
    memory: undefined,
    modelSelector: undefined,
  } as any
}

describe('brain toolset parity', () => {
  it('brain has all buildToolPack base tools', () => {
    const brain = createSolverBrain(makeConfig(), makeOptions())
    const baseTools = buildToolPack(
      { config: makeConfig(), skillRegistry: makeOptions().skillRegistry, workerPool: makeOptions().workerPool },
      { includeOrchestration: true, includeResearch: true, includePrimitives: true },
    )
    const brainKeys = new Set(Object.keys(brain.tools))
    const missing = Object.keys(baseTools).filter(k => !brainKeys.has(k))
    expect(missing, `Brain missing base tools: ${missing.join(', ')}`).toEqual([])
  })

  it('brain has all 3 critical graph tools', () => {
    const brain = createSolverBrain(makeConfig(), makeOptions())
    const tools = Object.keys(brain.tools)
    expect(tools).toContain('getGraphSchema')
    expect(tools).toContain('getCaptureOverview')
    expect(tools).toContain('queryRelations')
  })

  it('brain has loadSkillBody tool', () => {
    const brain = createSolverBrain(makeConfig(), makeOptions())
    expect(Object.keys(brain.tools)).toContain('loadSkillBody')
  })

  it('brain has brain-specific extras', () => {
    const brain = createSolverBrain(makeConfig(), makeOptions())
    const tools = Object.keys(brain.tools)
    expect(tools).toContain('listTools')
    expect(tools).toContain('loadTool')
    expect(tools).toContain('getToolResult')
    expect(tools).toContain('detectAuthFlows')
    expect(tools).toContain('testSessionValid')
    expect(tools).toContain('requestCouncil')
    expect(tools).toContain('generateReport')
    expect(tools).toContain('getPriorPatterns')
  })
})
