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

import { loadSkillReference, searchSkillTool } from '../../src/tools/skill-tools'
import { loadSkill, listReferences, loadReference, searchSkills } from '../../src/solver/skills/loader'

const mockListReferences = vi.mocked(listReferences)
const mockLoadReference = vi.mocked(loadReference)
const mockSearchSkills = vi.mocked(searchSkills)

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
})
