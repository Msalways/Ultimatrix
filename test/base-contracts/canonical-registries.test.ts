/**
 * Base Architecture Contracts — F2 Canonical Registries.
 *
 * I2: a skill imported mid-session (manageSkills) is immediately authorized
 * for worker spawning — even through a SkillRegistry instance whose snapshot
 * was warmed BEFORE the import. Snapshots authorize nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn(), success: vi.fn() },
}))
vi.mock('../../src/events/emitter', () => ({
  emitWorkerSpawned: vi.fn(),
  emitWorkerStarted: vi.fn(),
  emitWorkerCompleted: vi.fn(),
  emitWorkerError: vi.fn(),
}))
vi.mock('../../src/security/decision-ledger', () => ({
  getGlobalDecisionLedger: () => ({ recordDecision: vi.fn().mockReturnValue({ id: 'd' }) }),
}))
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({ queryNodes: vi.fn(() => []), getNode: vi.fn(() => undefined) }),
}))

const VALID = `---
name: i2-live-skill
description: "Imported mid-session for the I2 invariant"
category: test
tier: fast
toolRefs: [httpRequest]
triggers: ["i2"]
---

## Probe

\`\`\`http
GET /probe HTTP/1.1
Host: target.example
\`\`\`
`

let tempDir: string
let skillsMod: any

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'i2-'))
  skillsMod = await import('../../src/tools/skill-manage-tools')
  skillsMod.setImportedSkillsRoot(join(tempDir, 'skills-user'))
}, 60000)

afterEach(() => {
  skillsMod?.setImportedSkillsRoot(null)
  rmSync(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('I2 — mid-session import is immediately spawnable', () => {
  it('stale-warmed SkillRegistry authorizes the imported skill via live delegation', { timeout: 60000 }, async () => {
    const { SkillRegistry } = await import('../../src/solver/skills/registry')
    const registry = new SkillRegistry()
    registry.loadFromDirectory('skills') // warm snapshot BEFORE the import
    expect(registry.has('user/i2-live-skill')).toBe(false)

    const added = await (skillsMod.manageSkills as any).execute({ action: 'add', markdown: VALID })
    expect(added.ok).toBe(true)

    // Live delegation: no reloadFromDirectory call, same instance.
    expect(registry.has('user/i2-live-skill')).toBe(true)

    // The spawn gate passes now.
    const taskCoordinator = { run: vi.fn().mockResolvedValue({ status: 'completed', resultSummary: 'ok' }) }
    const { createSpawnWorkerTool } = await import('../../src/manager/tools/spawn-worker')
    const tool = createSpawnWorkerTool(
      { provider: 'groq', model: 'm', browser: { headless: true, viewport: { width: 1, height: 1 }, domSettleTimeout: 5, env: 'LOCAL', selfHeal: false, verbose: 0 }, memory: { lastMessages: 1, semanticRecall: false, workingMemory: false } } as any,
      registry as any,
      taskCoordinator as any,
      undefined,
    )
    const result = await (tool as any).execute({ task: 'run i2 probe', skillId: 'user/i2-live-skill' }, {})
    expect(result.status).toBe('completed')

    // And the worker factory can LOAD the body through the same authority.
    expect(registry.load('user/i2-live-skill').instructions.length).toBeGreaterThan(0)
  })

  it('removed skills stop authorizing immediately (live in both directions)', async () => {
    const { SkillRegistry } = await import('../../src/solver/skills/registry')
    const registry = new SkillRegistry()
    registry.loadFromDirectory('skills')

    await (skillsMod.manageSkills as any).execute({ action: 'add', markdown: VALID })
    expect(registry.has('user/i2-live-skill')).toBe(true)

    await (skillsMod.manageSkills as any).execute({ action: 'remove', id: 'user/i2-live-skill' })
    expect(registry.has('user/i2-live-skill')).toBe(false)
  })
})
