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
vi.mock('../../src/models/routing', () => ({
  resolveModelRef: () => ({ provider: 'nvidia', model: 'test-model', modelId: 'nvidia/test-model' }),
}))
vi.mock('../../src/models/context-window-registry', () => ({ ContextWindowRegistry: class { getContextWindow() { return 128_000 } } }))
vi.mock('../../src/models/schema-sanitizer', () => ({ createSanitizedInputSchema: (schema: unknown) => schema }))
vi.mock('../../src/solver/brain-instructions', () => ({ getBrainInstructions: () => 'test instructions' }))
vi.mock('../../src/browser/manager', () => ({ getActivePage: () => null }))
vi.mock('../../src/capture/human-observer', () => ({ getGlobalObserver: () => ({ getAuthDetector: () => ({ detectAuthState: async () => ({}) }) }) }))
vi.mock('../../src/graph/tool-result-store', () => ({ getToolResultStore: () => ({ get: () => null }) }))
vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => ({}) }))

import { createSolverBrain, filterToolsByVisionSupport, resolveBrainVisionSupport } from '../../src/solver/brain-tools'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'

const fakeScreenshot = { id: 'stagehand_screenshot', description: 'screenshot' } as any
const fakeHttp = { id: 'httpRequest', description: 'http' } as any

function brainWith(config: any, tools: Record<string, any>) {
  const extensionRegistry = new DynamicToolRegistry()
  Object.assign(extensionRegistry.getActiveToolset(), tools)
  const brain: any = createSolverBrain(config, {
    skillRegistry: { list: () => [], search: () => [] } as any,
    extensionRegistry,
  })
  return brain
}

const textOnlyConfig = { provider: 'nvidia', model: 'nvidia/test-model', engine: 'solver' } as any

describe('resolveBrainVisionSupport', () => {
  it('fail-closes for unknown models', () => {
    expect(resolveBrainVisionSupport({} as any, 'nvidia', 'some-model', 'nvidia/some-model')).toBe(false)
  })

  it('honors explicit user modelCapabilities grants and denials', () => {
    const granted = { modelCapabilities: { 'nvidia/test-model': { supportsVision: true } } } as any
    expect(resolveBrainVisionSupport(granted, 'nvidia', 'test-model', 'nvidia/test-model')).toBe(true)
    const denied = { modelCapabilities: { 'openai/gpt-4o': { supportsVision: false } } } as any
    expect(resolveBrainVisionSupport(denied, 'openai', 'gpt-4o', 'openai/gpt-4o')).toBe(false)
  })

  it('falls back to the live model registry seeds', () => {
    expect(resolveBrainVisionSupport({} as any, 'openai', 'gpt-4o', 'openai/gpt-4o')).toBe(true)
  })
})

describe('filterToolsByVisionSupport', () => {
  it('withholds the screenshot tool from text-only models, keeps everything else', () => {
    const out = filterToolsByVisionSupport({ stagehand_screenshot: fakeScreenshot, httpRequest: fakeHttp }, false)
    expect(out).not.toHaveProperty('stagehand_screenshot')
    expect(out).toHaveProperty('httpRequest')
  })

  it('keeps the screenshot tool for vision models', () => {
    const out = filterToolsByVisionSupport({ stagehand_screenshot: fakeScreenshot }, true)
    expect(out).toHaveProperty('stagehand_screenshot')
  })

  it('is a no-op when no vision-dependent tools are present', () => {
    const tools = { httpRequest: fakeHttp }
    expect(filterToolsByVisionSupport(tools, false)).toBe(tools)
  })
})

describe('brain vision gating (integration)', () => {
  it('excludes stagehand_screenshot for a text-only brain model', () => {
    const brain = brainWith(textOnlyConfig, { stagehand_screenshot: fakeScreenshot, httpRequest: fakeHttp })
    expect(brain.defaultOptions.activeTools).not.toContain('stagehand_screenshot')
    expect(brain.defaultOptions.activeTools).toContain('httpRequest')
  })

  it('keeps stagehand_screenshot when vision is granted in modelCapabilities', () => {
    const config = {
      ...textOnlyConfig,
      modelCapabilities: { 'nvidia/test-model': { supportsVision: true } },
    } as any
    const brain = brainWith(config, { stagehand_screenshot: fakeScreenshot, httpRequest: fakeHttp })
    expect(brain.defaultOptions.activeTools).toContain('stagehand_screenshot')
  })
})
