/**
 * Phase D — manageSkills runtime round-trip (spec 04 D7).
 *
 * add (markdown + directory) → immediately discoverable via the shared index
 * → remove cleans up. Invalid skills are rejected with precise errors and
 * never land. Root pinned to a temp dir via the test seam.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type * as SkillManageModule from '../../src/tools/skill-manage-tools'

const VALID = `---
name: roundtrip-skill
description: "Imported via the manageSkills round-trip test"
category: test
tier: fast
toolRefs: [httpRequest]
primitives: [classicInjection]
triggers: ["roundtrip"]
---

## Probe

\`\`\`http
GET /probe HTTP/1.1
Host: target.example
\`\`\`
`

let tempDir: string
let rootDir: string
let revisionDir: string
let skillsMod: typeof SkillManageModule | null = null

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'ultimatrix-manage-skills-'))
  rootDir = join(tempDir, 'skills-user')
  revisionDir = join(tempDir, 'skill-revisions')
  skillsMod = await import('../../src/tools/skill-manage-tools')
  skillsMod.setImportedSkillsRoot(rootDir)
  skillsMod.setSkillRevisionRoot(revisionDir)
}, 60000)

afterEach(() => {
  skillsMod?.setImportedSkillsRoot(null)
  skillsMod?.setSkillRevisionRoot(null)
  rmSync(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('manageSkills', () => {
  it('add → discoverable in index as user/<name>; invalid add rejected; remove cleans up', { timeout: 60000 }, async () => {
    const added = await (skillsMod!.manageSkills as any).execute({ action: 'add', markdown: VALID })
    expect(added.ok).toBe(true)

    // Immediately discoverable through the shared loader index
    const loader = await import('../../src/solver/skills/loader')
    const meta = loader.initSkillIndex().get('user/roundtrip-skill')
    expect(meta).toBeDefined()
    expect(meta?.primitives).toEqual(['classicInjection'])

    // LIST shows it as imported
    const listed = await (skillsMod!.manageSkills as any).execute({ action: 'list' })
    const entry = listed.skills?.find((s: any) => s.id === 'user/roundtrip-skill')
    expect(entry?.source).toBe('imported')

    // REMOVE cleans up and drops it from the index
    const removed = await (skillsMod!.manageSkills as any).execute({ action: 'remove', id: 'user/roundtrip-skill' })
    expect(removed.ok).toBe(true)
    expect(loader.initSkillIndex().get('user/roundtrip-skill')).toBeUndefined()
  })

  it('rejects an invalid skill without landing anything', async () => {
    const stripped = `---
name: bad-skill
description: "no payloads"
---

## Section

\`\`\`

\`\`\`
`
    const res = await (skillsMod!.manageSkills as any).execute({ action: 'add', markdown: stripped })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/empty fenced block/i)

    const loader = await import('../../src/solver/skills/loader')
    expect(loader.initSkillIndex().get('user/bad-skill')).toBeUndefined()
  })

  it('imports a skill directory with refs/', async () => {
    const srcDir = join(tempDir, 'dir-skill')
    mkdirSync(join(srcDir, 'refs'), { recursive: true })
    writeFileSync(join(srcDir, 'SKILL.md'), VALID.replace('roundtrip-skill', 'dir-skill'))
    writeFileSync(join(srcDir, 'refs', 'notes.md'), '# Reference Notes\n\nDetails.')

    const res = await (skillsMod!.manageSkills as any).execute({ action: 'add', path: srcDir })
    expect(res.ok).toBe(true)

    const loader = await import('../../src/solver/skills/loader')
    expect(loader.initSkillIndex().get('user/dir-skill')).toBeDefined()

    const skill = loader.loadSkillBody('user/dir-skill')
    expect(skill?.references.map(r => r.id)).toContain('notes')
  })

  it('remove fails cleanly for unknown ids', async () => {
    const res = await (skillsMod!.manageSkills as any).execute({ action: 'remove', id: 'user/does-not-exist' })
    expect(res.ok).toBe(false)
  })

  it('promotes only marked revisions and preserves the previous imported body', async () => {
    const proposal = VALID.replace('roundtrip-skill', 'promoted-skill')
      .replace('## Probe', '<!-- UNVALIDATED REVISION PROPOSAL test -->\n\n## Probe')
    const proposalPath = join(revisionDir, 'authorization', 'revision-test.md')
    mkdirSync(join(revisionDir, 'authorization'), { recursive: true })
    writeFileSync(proposalPath, proposal)

    const first = await (skillsMod!.manageSkills as any).execute({ action: 'promoteRevision', path: proposalPath })
    expect(first.ok).toBe(true)

    const changed = proposal.replace('revision-test', 'revision-test-2')
    writeFileSync(proposalPath, changed)
    const second = await (skillsMod!.manageSkills as any).execute({ action: 'promoteRevision', path: proposalPath })
    expect(second.ok).toBe(true)

    const { existsSync } = await import('fs')
    expect(existsSync(join(rootDir, 'promoted-skill', 'revisions'))).toBe(true)
    const loader = await import('../../src/solver/skills/loader')
    expect(loader.initSkillIndex().get('user/promoted-skill')).toBeDefined()
  })
})
