import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const SKILLS_DIR = join(process.cwd(), 'skills')

let loadSkillFragments: typeof import('../../src/solver/skills/loader').loadSkillFragments
let listSkillFragments: typeof import('../../src/solver/skills/loader').listSkillFragments
let loadSkillBody: typeof import('../../src/solver/skills/loader').loadSkillBody

beforeEach(async () => {
  const mod = await import('../../src/solver/skills/loader')
  loadSkillFragments = mod.loadSkillFragments
  listSkillFragments = mod.listSkillFragments
  loadSkillBody = mod.loadSkillBody
})

describe('Phase 5: Knowledge Fragments', () => {
  describe('loadSkillFragments', () => {
    it('returns empty array for skill without subfolder', () => {
      // "recon" skill has no subfolder → no fragments
      const frags = loadSkillFragments('recon')
      expect(frags).toEqual([])
    })

    it('returns empty array for unknown skill ID', () => {
      const frags = loadSkillFragments('nonexistent-skill-id')
      expect(frags).toEqual([])
    })

    it('loads all fragments from authorization subfolder', () => {
      const frags = loadSkillFragments('authorization')
      // authorization has 5 fragments: jwt-attacks, oauth-testing, idor-automation,
      // rbac-testing, session-management, forced-browsing
      expect(frags.length).toBeGreaterThanOrEqual(5)
      const ids = frags.map(f => f.id)
      expect(ids).toContain('jwt-attacks')
      expect(ids).toContain('oauth-testing')
      expect(ids).toContain('idor-automation')
      expect(ids).toContain('rbac-testing')
      expect(ids).toContain('session-management')
      expect(ids).toContain('forced-browsing')
    })

    it('loads specific fragments by ID', () => {
      const frags = loadSkillFragments('authorization', ['jwt-attacks', 'idor-automation'])
      expect(frags.length).toBe(2)
      const ids = frags.map(f => f.id)
      expect(ids).toContain('jwt-attacks')
      expect(ids).toContain('idor-automation')
      expect(ids).not.toContain('oauth-testing')
    })

    it('each fragment has id, title, and content', () => {
      const frags = loadSkillFragments('authorization')
      for (const frag of frags) {
        expect(typeof frag.id).toBe('string')
        expect(frag.id.length).toBeGreaterThan(0)
        expect(typeof frag.title).toBe('string')
        expect(typeof frag.content).toBe('string')
        expect(frag.content.length).toBeGreaterThan(0)
      }
    })

    it('fragment title matches first heading in content', () => {
      const frags = loadSkillFragments('authorization')
      const jwt = frags.find(f => f.id === 'jwt-attacks')
      expect(jwt).toBeDefined()
      expect(jwt!.title).toBe('JWT Attack Techniques')
    })
  })

  describe('listSkillFragments', () => {
    it('returns fragment IDs for authorization', () => {
      const ids = listSkillFragments('authorization')
      expect(ids.length).toBeGreaterThanOrEqual(5)
      expect(ids).toContain('jwt-attacks')
      expect(ids).toContain('oauth-testing')
      expect(ids).toContain('idor-automation')
    })

    it('returns empty array for skill without subfolder', () => {
      expect(listSkillFragments('recon')).toEqual([])
    })

    it('returns empty array for unknown skill', () => {
      expect(listSkillFragments('nonexistent-skill')).toEqual([])
    })
  })

  describe('backward compatibility', () => {
    it('loadSkillBody returns fragments for skills with subfolders', () => {
      const skill = loadSkillBody('authorization')
      expect(skill).not.toBeNull()
      expect(skill!.fragments).toBeDefined()
      expect(skill!.fragments.length).toBeGreaterThanOrEqual(5)
      // instructions still has the compact contract content
      expect(skill!.instructions).toContain('Authorization Testing')
      expect(skill!.instructions).toContain('When to Use')
    })

    it('loadSkillBody returns empty fragments for skills without subfolders', () => {
      const skill = loadSkillBody('recon')
      expect(skill).not.toBeNull()
      expect(skill!.fragments).toEqual([])
    })
  })
})
