import { describe, it, expect } from 'vitest'
import { buildInstructions } from '../../src/analysis/instructions'
import { BUILTIN_SKILLS } from '../../src/analysis/skill-loader'
import type { Skill } from '../../src/analysis/skill-loader'
import type { HarArchive } from '../../src/capture/har-parser'

const mockHar: HarArchive = {
  log: {
    version: '1.2',
    creator: { name: 'test', version: '1.0' },
    entries: [
      {
        startedDateTime: '2026-01-01T00:00:00.000Z',
        time: 100,
        request: {
          method: 'GET',
          url: 'https://api.example.com/users',
          cookies: [],
          headers: [],
          queryString: [],
        },
        response: {
          status: 200,
          cookies: [],
          headers: [],
          content: { size: 100, mimeType: 'application/json', text: '{}' },
        },
      },
    ],
  },
}

const mockSkills: Skill[] = [
  {
    name: 'test-skill',
    description: 'A test skill',
    content: '# Test Skill\n\nThis is a test skill for unit testing.',
    category: 'test',
    filePath: '/test/test-skill.md',
  },
]

describe('Instructions', () => {
  describe('buildInstructions', () => {
    it('should build instructions with all sections', () => {
      const instructions = buildInstructions({
        skills: mockSkills,
        harData: mockHar,
        targetUrl: 'https://api.example.com',
      })

      expect(instructions).toContain('Security Researcher')
      expect(instructions).toContain('Workflow')
      expect(instructions).toContain('Reasoning Framework')
      expect(instructions).toContain('Knowledge Base')
      expect(instructions).toContain('Captured Traffic Context')
      expect(instructions).toContain('Constraints')
    })

    it('should include target URL', () => {
      const instructions = buildInstructions({
        skills: [],
        harData: mockHar,
        targetUrl: 'https://api.example.com',
      })

      expect(instructions).toContain('https://api.example.com')
    })

    it('should include credentials when provided', () => {
      const instructions = buildInstructions({
        skills: [],
        harData: mockHar,
        targetUrl: 'https://api.example.com',
        credentials: {
          admin: { email: 'admin@test.com', password: 'pass123' },
        },
      })

      expect(instructions).toContain('admin')
      expect(instructions).toContain('admin@test.com')
    })

    it('should handle empty skills', () => {
      const instructions = buildInstructions({
        skills: [],
        harData: mockHar,
        targetUrl: 'https://api.example.com',
      })

      expect(instructions).toContain('No specific vulnerability knowledge loaded')
    })

    it('should include skill content', () => {
      const instructions = buildInstructions({
        skills: mockSkills,
        harData: mockHar,
        targetUrl: 'https://api.example.com',
      })

      expect(instructions).toContain('Test Skill')
      expect(instructions).toContain('This is a test skill for unit testing')
    })

    it('should mention no hardcoding constraint', () => {
      const instructions = buildInstructions({
        skills: [],
        harData: mockHar,
        targetUrl: 'https://api.example.com',
      })

      expect(instructions).toContain('No hardcoding')
    })
  })
})
