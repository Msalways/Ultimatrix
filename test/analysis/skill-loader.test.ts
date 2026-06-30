import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadSkill,
  loadAllSkills,
  getSkillsByCategory,
  getCategories,
  getBuiltinSkill,
  BUILTIN_SKILLS,
} from '../../src/analysis/skill-loader'

const testDir = resolve(tmpdir(), 'ultimatrix-test-skills')
const testCategory = 'test-category'

beforeAll(async () => {
  await mkdir(resolve(testDir, testCategory), { recursive: true })
  await writeFile(
    resolve(testDir, testCategory, 'test-skill.md'),
    `---
description: A test skill for unit testing
---
# Test Skill

This is a test skill for unit testing purposes.

## Key Concepts
- Test concept 1
- Test concept 2
`
  )
  await writeFile(
    resolve(testDir, testCategory, 'another-skill.md'),
    `# Another Skill

Another test skill without frontmatter.
`
  )
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('SkillLoader', () => {
  describe('loadSkill', () => {
    it('should load a skill by name', async () => {
      const skill = await loadSkill('test-skill', testDir)
      expect(skill).not.toBeNull()
      expect(skill?.name).toBe('test-skill')
      expect(skill?.category).toBe('test-category')
    })

    it('should return null for non-existent skill', async () => {
      const skill = await loadSkill('non-existent', testDir)
      expect(skill).toBeNull()
    })

    it('should parse description from frontmatter', async () => {
      const skill = await loadSkill('test-skill', testDir)
      expect(skill?.description).toBe('A test skill for unit testing')
    })
  })

  describe('loadAllSkills', () => {
    it('should load all skills from directory', async () => {
      const skills = await loadAllSkills(testDir)
      expect(skills.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('getSkillsByCategory', () => {
    it('should filter by category', async () => {
      const skills = await getSkillsByCategory('test-category', testDir)
      expect(skills.length).toBe(2)
    })

    it('should return empty for non-existent category', async () => {
      const skills = await getSkillsByCategory('non-existent', testDir)
      expect(skills).toHaveLength(0)
    })
  })

  describe('getCategories', () => {
    it('should list categories', async () => {
      const categories = await getCategories(testDir)
      expect(categories.length).toBeGreaterThanOrEqual(1)
      expect(categories[0].skills.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('getBuiltinSkill', () => {
    it('should return authorization skill', () => {
      const skill = getBuiltinSkill('authorization')
      expect(skill).toBeDefined()
      expect(skill).toContain('Authorization Testing')
    })

    it('should return business-logic skill', () => {
      const skill = getBuiltinSkill('business-logic')
      expect(skill).toBeDefined()
      expect(skill).toContain('Business Logic Testing')
    })

    it('should return information-disclosure skill', () => {
      const skill = getBuiltinSkill('information-disclosure')
      expect(skill).toBeDefined()
      expect(skill).toContain('Information Disclosure Testing')
    })

    it('should return race-conditions skill', () => {
      const skill = getBuiltinSkill('race-conditions')
      expect(skill).toBeDefined()
      expect(skill).toContain('Race Condition Testing')
    })

    it('should return undefined for non-existent builtin', () => {
      const skill = getBuiltinSkill('non-existent')
      expect(skill).toBeUndefined()
    })
  })

  describe('BUILTIN_SKILLS', () => {
    it('should have all expected categories', () => {
      expect(Object.keys(BUILTIN_SKILLS)).toEqual(
        expect.arrayContaining([
          'authorization',
          'business-logic',
          'information-disclosure',
          'race-conditions',
        ])
      )
    })
  })
})
