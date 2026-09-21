import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryPolicyError } from '../../src/memory/policy'
import { SkillKnowledgeStore } from '../../src/intelligence/skill-knowledge'

describe('SkillKnowledgeStore', () => {
  let directory: string
  let store: SkillKnowledgeStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ultimatrix-skill-knowledge-'))
    store = new SkillKnowledgeStore({ path: join(directory, 'knowledge.json') })
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('merges repeated target-independent outcomes and persists them', async () => {
    await store.record({ skillId: 'authorization', techniqueId: 'idor', outcome: 'confirmed', evidenceCount: 2 })
    await store.record({ skillId: 'authorization', techniqueId: 'idor', outcome: 'confirmed', evidenceCount: 1 })
    await store.record({ skillId: 'authorization', techniqueId: 'idor', outcome: 'failed' })

    const records = await store.listForSkill('authorization')
    expect(records).toHaveLength(1)
    expect(records[0].confirmed).toBe(2)
    expect(records[0].failed).toBe(1)
    expect(records[0].evidenceCount).toBe(3)

    const reloaded = new SkillKnowledgeStore({ path: join(directory, 'knowledge.json') })
    expect((await reloaded.list())[0].techniqueId).toBe('idor')
  })

  it('fails closed when a target-sensitive value is supplied', async () => {
    await expect(store.record({
      techniqueId: 'idor',
      outcome: 'confirmed',
      contextTags: ['https://target.example/api/users/123'],
    })).rejects.toBeInstanceOf(MemoryPolicyError)
  })
})
