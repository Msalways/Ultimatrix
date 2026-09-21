import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getAllSkills, readSkillMarkdown } from '../../src/solver/skills/loader'
import { synthesizeSharedSkillRevisions } from '../../src/intelligence/skill-revisions'
import type { SkillKnowledgeRecord } from '../../src/intelligence/skill-knowledge'

describe('shared skill revision proposals', () => {
  let directory: string

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('creates a validated, target-independent proposal without changing the canonical source', async () => {
    directory = await mkdtemp(join(tmpdir(), 'ultimatrix-skill-revisions-'))
    const skill = getAllSkills().find(candidate => candidate.id === 'authorization')
    expect(skill).toBeDefined()
    const original = readSkillMarkdown('authorization')
    expect(original).toBeTruthy()

    const records: SkillKnowledgeRecord[] = [{
      skillId: 'authorization',
      techniqueId: 'idor',
      contextTags: ['rest', 'two-actor'],
      confirmed: 3,
      failed: 0,
      inconclusive: 1,
      evidenceCount: 4,
      firstSeenAt: new Date(0).toISOString(),
      lastSeenAt: new Date().toISOString(),
    }]
    const result = await synthesizeSharedSkillRevisions({ outDir: directory, skills: [skill!], records })
    expect(result.created).toHaveLength(1)
    expect(result.created[0].path).toContain('revision-')

    const proposal = await readFile(result.created[0].path, 'utf8')
    expect(proposal).toContain('UNVALIDATED REVISION PROPOSAL')
    expect(proposal).toContain('confirmed 3')
    expect(proposal).not.toContain('target.example')
    expect(readSkillMarkdown('authorization')).toBe(original)
  })

  it('does not propose a revision from a single or net-negative outcome', async () => {
    directory = await mkdtemp(join(tmpdir(), 'ultimatrix-skill-revisions-'))
    const skill = getAllSkills().find(candidate => candidate.id === 'authorization')!
    const records: SkillKnowledgeRecord[] = [{
      skillId: 'authorization', techniqueId: 'idor', contextTags: [],
      confirmed: 1, failed: 2, inconclusive: 0, evidenceCount: 0,
      firstSeenAt: new Date(0).toISOString(), lastSeenAt: new Date().toISOString(),
    }]
    const result = await synthesizeSharedSkillRevisions({ outDir: directory, skills: [skill], records })
    expect(result.created).toHaveLength(0)
  })
})
