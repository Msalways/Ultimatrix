import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

vi.mock('../../src/solver/skills/loader', () => ({
  loadSkill: vi.fn(),
  listReferences: vi.fn(),
  loadReference: vi.fn(),
  searchSkills: vi.fn(),
}))

import { loadSkillReference, searchSkillTool, loadSkillBodyTool } from '../../src/tools/skill-tools'
import { loadSkill, listReferences, loadReference, searchSkills } from '../../src/solver/skills/loader'

const mockListReferences = vi.mocked(listReferences)
const mockLoadReference = vi.mocked(loadReference)
const mockSearchSkills = vi.mocked(searchSkills)
const mockLoadSkill = vi.mocked(loadSkill)

async function callTool(tool: any, args: any) {
  return tool.execute(args, {})
}

describe('skill-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadSkillReference', () => {
    it('lists references when no referenceId provided', async () => {
      mockListReferences.mockReturnValue([
        { id: 'ref-1', title: 'SQL Injection Guide', content: 'content' },
        { id: 'ref-2', title: 'XSS Cheat Sheet', content: 'content' },
      ])

      const result = await callTool(loadSkillReference, { skillId: 'pentest-flow' })
      expect(result.ok).toBe(true)
      expect(result.value.message).toContain('2 reference(s)')
      expect(result.value.references).toEqual([
        { id: 'ref-1', title: 'SQL Injection Guide' },
        { id: 'ref-2', title: 'XSS Cheat Sheet' },
      ])
    })

    it('returns message when no references found', async () => {
      mockListReferences.mockReturnValue([])

      const result = await callTool(loadSkillReference, { skillId: 'empty-skill' })
      expect(result.ok).toBe(true)
      expect(result.value.message).toContain('No references found')
      expect(result.value.references).toEqual([])
    })

    it('loads specific reference content', async () => {
      mockLoadReference.mockReturnValue('# SQL Injection\nDetailed guide content here.')

      const result = await callTool(loadSkillReference, { skillId: 'pentest-flow', referenceId: 'ref-1' })
      expect(result.ok).toBe(true)
      expect(result.value.skillId).toBe('pentest-flow')
      expect(result.value.referenceId).toBe('ref-1')
      expect(result.value.content).toContain('SQL Injection')
    })

    it('returns error for missing reference', async () => {
      mockLoadReference.mockReturnValue(null)

      const result = await callTool(loadSkillReference, { skillId: 'pentest-flow', referenceId: 'nonexistent' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('searchSkillTool', () => {
    it('returns matching skills', async () => {
      mockSearchSkills.mockReturnValue([
        {
          id: 'pentest-flow',
          name: 'Pentest Flow',
          category: 'core',
          description: 'Core pentesting methodology',
          instructions: 'test',
          references: [{ id: 'r1', title: 'Guide', content: 'c' }],
          toolRefs: [],
        },
      ])

      const result = await callTool(searchSkillTool, { query: 'injection' })
      expect(result.ok).toBe(true)
      expect(result.value.count).toBe(1)
      expect(result.value.skills[0].id).toBe('pentest-flow')
    })

    it('returns empty for no match', async () => {
      mockSearchSkills.mockReturnValue([])

      const result = await callTool(searchSkillTool, { query: 'quantum physics' })
      expect(result.ok).toBe(true)
      expect(result.value.count).toBe(0)
      expect(result.value.skills).toEqual([])
    })
  })

  describe('loadSkillBodyTool', () => {
    it('returns full instructions for valid skill ID', async () => {
      mockLoadSkill.mockReturnValue({
        id: 'injection/exploitation',
        name: 'Exploitation',
        description: 'Exploitation methodology',
        tier: 1,
        instructions: '# SQL Injection\nDetailed attack methodology...',
        toolRefs: ['httpRequest'],
        toolChains: [{ name: 'sqli-chain', description: 'SQLi testing', steps: ['step1', 'step2'] }],
        compositionRules: { requires: ['auth-security/authorization'] },
        references: [{ id: 'ref-1', title: 'SQLi Guide', content: 'content' }],
      } as any)

      const result = await callTool(loadSkillBodyTool, { skillId: 'injection/exploitation' })
      expect(result.ok).toBe(true)
      expect(result.value.id).toBe('injection/exploitation')
      expect(result.value.instructions).toContain('SQL Injection')
      expect(result.value.toolRefs).toEqual(['httpRequest'])
      expect(result.value.toolChains).toHaveLength(1)
      expect(result.value.compositionRules.requires).toEqual(['auth-security/authorization'])
      expect(result.value.references).toEqual([{ id: 'ref-1', title: 'SQLi Guide' }])
    })

    it('returns ok: false for unknown skill ID', async () => {
      mockLoadSkill.mockReturnValue(null)

      const result = await callTool(loadSkillBodyTool, { skillId: 'nonexistent/skill' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('includes toolRefs, toolChains, compositionRules', async () => {
      mockLoadSkill.mockReturnValue({
        id: 'web-attacks/web-pentest',
        name: 'Web Pentest',
        description: 'Web testing',
        tier: 1,
        instructions: 'Web testing methodology',
        toolRefs: ['httpRequest', 'queryGraph'],
        toolChains: [
          { name: 'recon', description: 'Recon chain', steps: ['nmap', 'dirbust'] },
          { name: 'exploit', description: 'Exploit chain', steps: ['inject', 'verify'] },
        ],
        compositionRules: { enhances: ['injection/exploitation'], conflicts: [] },
        references: [],
      } as any)

      const result = await callTool(loadSkillBodyTool, { skillId: 'web-attacks/web-pentest' })
      expect(result.ok).toBe(true)
      expect(result.value.toolRefs).toEqual(['httpRequest', 'queryGraph'])
      expect(result.value.toolChains).toHaveLength(2)
      expect(result.value.compositionRules.enhances).toEqual(['injection/exploitation'])
    })

    it('includes references array', async () => {
      mockLoadSkill.mockReturnValue({
        id: 'test-skill',
        name: 'Test',
        description: 'Test',
        tier: 1,
        instructions: 'Test',
        toolRefs: [],
        toolChains: [],
        compositionRules: {},
        references: [
          { id: 'r1', title: 'Guide A', content: 'a' },
          { id: 'r2', title: 'Guide B', content: 'b' },
        ],
      } as any)

      const result = await callTool(loadSkillBodyTool, { skillId: 'test-skill' })
      expect(result.ok).toBe(true)
      expect(result.value.references).toEqual([
        { id: 'r1', title: 'Guide A' },
        { id: 'r2', title: 'Guide B' },
      ])
    })

    it('second call returns same data (caching)', async () => {
      const skill = {
        id: 'cached-skill',
        name: 'Cached',
        description: 'Cached skill',
        tier: 1,
        instructions: 'Cached body',
        toolRefs: [],
        toolChains: [],
        compositionRules: {},
        references: [],
      }
      mockLoadSkill.mockReturnValue(skill as any)

      const r1 = await callTool(loadSkillBodyTool, { skillId: 'cached-skill' })
      const r2 = await callTool(loadSkillBodyTool, { skillId: 'cached-skill' })
      expect(r1.value).toEqual(r2.value)
    })
  })
})
