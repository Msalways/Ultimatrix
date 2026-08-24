import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/solver/skills/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/solver/skills/loader')>()),
  initSkillIndex: vi.fn(),
  loadSkillBody: vi.fn(),
}))

import { SkillRegistry } from '../../src/solver/skills/registry'
import { loadSkillBody } from '../../src/solver/skills/loader'

const mockLoadSkillBody = vi.mocked(loadSkillBody)

function meta(id: string) {
  return { id, name: id, description: `${id} skill`, category: 'test', tier: 1, toolRefs: [], toolChains: [], compositionRules: {}, references: [] }
}

describe('skill catalog activation boundary', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new SkillRegistry()
    ;(registry as any).skills = new Map([['injection/exploitation', meta('injection/exploitation')]])
  })

  it('metadata search never loads a skill body', () => {
    expect(registry.search('injection')).toHaveLength(1)
    expect(mockLoadSkillBody).not.toHaveBeenCalled()
  })

  it('loads only an exact catalog id', () => {
    mockLoadSkillBody.mockReturnValue({ ...meta('injection/exploitation'), instructions: 'methodology' } as any)
    expect(registry.load('injection/exploitation').instructions).toBe('methodology')
    expect(mockLoadSkillBody).toHaveBeenCalledWith('injection/exploitation')
  })

  it('fails closed before loading an unknown id', () => {
    expect(() => registry.load('unknown')).toThrow('Skill not found: unknown')
    expect(mockLoadSkillBody).not.toHaveBeenCalled()
  })
})
