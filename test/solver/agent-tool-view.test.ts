import { describe, expect, it, vi } from 'vitest'

vi.mock('@mastra/core/agent', () => ({
  Agent: class { tools: Record<string, unknown>; constructor(config: any) { this.tools = config.tools } },
}))
vi.mock('../../src/models/factory', () => ({ resolveModel: () => ({ model: 'test' }) }))
vi.mock('../../src/models/routing', () => ({ resolveModelRef: () => ({ model: 'test', modelId: 'test' }) }))
vi.mock('../../src/models/schema-sanitizer', () => ({ createSanitizedInputSchema: (schema: unknown) => schema }))
vi.mock('../../src/solver/skills/tool-filter', () => ({ resolveToolsForSkills: () => ['allowed'] }))
vi.mock('../../src/browser/dialog-inject', () => ({ wrapStagehandTools: () => ({ browserAction: { id: 'browserAction' } }) }))

import { createAgent } from '../../src/mastra'

describe('agent tool view', () => {
  it('filters builtins, extras, and browser tools in one final intersection', () => {
    const agent = createAgent({ provider: 'test', model: 'test' } as any, {
      tools: { allowed: { id: 'allowed' }, blockedBuiltin: { id: 'blockedBuiltin' } } as any,
      skillIds: ['exact-skill'],
      extraTools: { blockedExtra: { id: 'blockedExtra' } },
      browser: {} as any,
    }) as any

    expect(Object.keys(agent.tools)).toEqual(['allowed'])
  })
})
