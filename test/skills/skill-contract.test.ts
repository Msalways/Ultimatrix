import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TEST_SKILLS_DIR = join(process.cwd(), 'test', 'fixtures', 'skill-contract-test')

let loadSkill: typeof import('../../src/solver/skills/loader').loadSkill
let getAllSkills: typeof import('../../src/solver/skills/loader').getAllSkills
let resetSkillCache: typeof import('../../src/solver/skills/loader').resetSkillCache
let configureSkillSources: typeof import('../../src/solver/skills/loader').configureSkillSources

beforeEach(async () => {
  const mod = await import('../../src/solver/skills/loader')
  loadSkill = mod.loadSkill
  getAllSkills = mod.getAllSkills
  resetSkillCache = mod.resetSkillCache
  configureSkillSources = mod.configureSkillSources
  // Clear extra dirs first, then reset cache
  configureSkillSources([], [])
  resetSkillCache()
  // Clean up any leftover test fixtures
  if (existsSync(TEST_SKILLS_DIR)) rmSync(TEST_SKILLS_DIR, { recursive: true, force: true })
})

/** Helper: create a skill in the test fixture dir and return its namespaced ID */
function createTestSkill(name: string, frontmatter: string, body: string): string {
  const skillDir = join(TEST_SKILLS_DIR, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`)
  configureSkillSources([TEST_SKILLS_DIR], [])
  return `user/${name}`  // extra dirs are scanned with 'user' namespace
}

describe('Skill Contract (Phase A)', () => {
  describe('backward compatibility', () => {
    it('non-contract skills have contract: undefined', () => {
      const skills = getAllSkills()
      expect(skills.length).toBeGreaterThan(0)
      // Most skills don't have contracts yet — only authorization does (Phase B pilot)
      const nonContractSkills = skills.filter(s => s.id !== 'authorization')
      for (const skill of nonContractSkills) {
        expect(skill.contract).toBeUndefined()
      }
    })

    it('authorization skill has a contract (Phase B pilot)', () => {
      const skill = loadSkill('authorization')
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.capabilities).toContain('network.request')
    })

    it('recon skill has no contract', () => {
      const skill = loadSkill('recon')
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeUndefined()
    })

    it('exploitation skill has no contract', () => {
      const skill = loadSkill('exploitation')
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeUndefined()
    })
  })

  describe('contract parsing from YAML frontmatter', () => {
    it('parses requires.capabilities', () => {
      const id = createTestSkill('capabilities-skill',
        'name: capabilities-skill\ndescription: "Test"\ntier: powerful\ntoolRefs: [httpRequest]\nrequires:\n  capabilities:\n    - network.request\n    - response.compare\n    - session.actor-context',
        '# Capabilities Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.capabilities).toEqual([
        'network.request',
        'response.compare',
        'session.actor-context',
      ])
    })

    it('parses procedure.stages', () => {
      const id = createTestSkill('procedure-skill',
        'name: procedure-skill\ndescription: "Test"\ntier: balanced\ntoolRefs: [httpRequest]\nprocedure:\n  stages:\n    - id: baseline\n      goal: Capture owner behavior.\n    - id: compare\n      goal: Compare observations.',
        '# Procedure Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.procedure).toEqual([
        { id: 'baseline', goal: 'Capture owner behavior.' },
        { id: 'compare', goal: 'Compare observations.' },
      ])
    })

    it('parses verification.coverage', () => {
      const id = createTestSkill('coverage-skill',
        'name: coverage-skill\ndescription: "Test"\ntier: fast\ntoolRefs: [httpRequest]\nverification:\n  coverage:\n    - id: owner-baseline\n      required: true\n    - id: alternate-actor\n      required: true\n    - id: optional-check\n      required: false',
        '# Coverage Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.coverage).toEqual([
        { id: 'owner-baseline', required: true },
        { id: 'alternate-actor', required: true },
        { id: 'optional-check', required: false },
      ])
    })

    it('parses output.schema', () => {
      const id = createTestSkill('output-skill',
        'name: output-skill\ndescription: "Test"\ntier: balanced\ntoolRefs: [httpRequest]\noutput:\n  schema: TestConclusion',
        '# Output Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.output).toEqual({ schema: 'TestConclusion' })
    })

    it('parses full contract with all fields', () => {
      const id = createTestSkill('full-contract-skill',
        'name: full-contract-skill\ndescription: "Test"\ntier: powerful\ntoolRefs: [httpRequest, writeFinding]\nprimitives: [authBypass]\nrequires:\n  capabilities:\n    - network.request\n    - primitive.execute\nprocedure:\n  stages:\n    - id: baseline\n      goal: Establish baseline.\n    - id: attack\n      goal: Execute attack.\n    - id: verify\n      goal: Verify result.\nverification:\n  coverage:\n    - id: owner-baseline\n      required: true\n    - id: attack-success\n      required: true\noutput:\n  schema: AttackConclusion',
        '# Full Contract Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.capabilities).toEqual(['network.request', 'primitive.execute'])
      expect(skill!.contract!.procedure).toHaveLength(3)
      expect(skill!.contract!.procedure[0].id).toBe('baseline')
      expect(skill!.contract!.procedure[2].id).toBe('verify')
      expect(skill!.contract!.coverage).toHaveLength(2)
      expect(skill!.contract!.coverage[0].required).toBe(true)
      expect(skill!.contract!.coverage[1].required).toBe(true)
      expect(skill!.contract!.output.schema).toBe('AttackConclusion')
      expect(skill!.primitives).toEqual(['authBypass'])
      expect(skill!.toolRefs).toContain('httpRequest')
    })

    it('returns contract: undefined when no contract fields present', () => {
      const id = createTestSkill('no-contract-skill',
        'name: no-contract-skill\ndescription: "Test"\ntier: fast\ntoolRefs: [httpRequest]',
        '# No Contract Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeUndefined()
    })

    it('gracefully handles malformed contract fields', () => {
      const id = createTestSkill('malformed-skill',
        'name: malformed-skill\ndescription: "Test"\ntier: fast\ntoolRefs: [httpRequest]\nrequires: "not-an-object"\nprocedure: [1, 2, 3]\nverification: true\noutput: "also-not-an-object"',
        '# Malformed Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeUndefined()
    })

    it('filters out non-string capability IDs', () => {
      const id = createTestSkill('mixed-types-skill',
        'name: mixed-types-skill\ndescription: "Test"\ntier: fast\ntoolRefs: [httpRequest]\nrequires:\n  capabilities:\n    - network.request\n    - 123\n    - true\n    - null\n    - response.compare',
        '# Mixed Types Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.capabilities).toEqual(['network.request', 'response.compare'])
    })

    it('handles empty procedure stages gracefully', () => {
      const id = createTestSkill('empty-stages-skill',
        'name: empty-stages-skill\ndescription: "Test"\ntier: fast\ntoolRefs: [httpRequest]\nprocedure:\n  stages: []\nverification:\n  coverage: []\noutput:\n  schema: ""',
        '# Empty Stages Skill\n\nTest body.')

      const skill = loadSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.contract).toBeDefined()
      expect(skill!.contract!.procedure).toEqual([])
      expect(skill!.contract!.coverage).toEqual([])
      expect(skill!.contract!.output.schema).toBe('')
    })
  })

  describe('all 74 skills still parse cleanly', () => {
    it('no regression on existing skill index', () => {
      const skills = getAllSkills()
      expect(skills.length).toBe(74)
      for (const skill of skills) {
        expect(typeof skill.id).toBe('string')
        expect(typeof skill.name).toBe('string')
        expect(typeof skill.description).toBe('string')
        expect(skill.tier).toBeDefined()
        expect(Array.isArray(skill.toolRefs)).toBe(true)
        expect(Array.isArray(skill.primitives)).toBe(true)
        expect(Array.isArray(skill.triggers)).toBe(true)
      }
    })
  })
})
