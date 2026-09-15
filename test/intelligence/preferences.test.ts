import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PreferencesManager } from '../../src/intelligence/preferences'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { randomBytes } from 'crypto'

const TEST_DIR = resolve('output', 'test-prefs')

describe('PreferencesManager', () => {
  let manager: PreferencesManager
  let testPath: string

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    testPath = resolve(TEST_DIR, `prefs-${randomBytes(4).toString('hex')}.json`)
    manager = new PreferencesManager(testPath)
  })

  afterEach(() => {
    try { unlinkSync(testPath) } catch { /* best effort */ }
  })

  it('records a preference pair', () => {
    manager.record('user_correction',
      { action: 'GET /api', reason: 'wrong endpoint' },
      { action: 'POST /api', reason: 'correct method' },
      '/api/users',
    )
    expect(manager.count()).toBe(1)
  })

  it('filters by context', () => {
    manager.record('user_correction',
      { action: 'A', reason: 'wrong' },
      { action: 'B', reason: 'right' },
      '/api/users',
    )
    manager.record('exploit_proof',
      { action: 'C', reason: 'failed' },
      { action: 'D', reason: 'worked' },
      '/api/auth',
    )
    expect(manager.getByContext('users')).toHaveLength(1)
    expect(manager.getByContext('auth')).toHaveLength(1)
  })

  it('filters by source', () => {
    manager.record('user_correction',
      { action: 'A', reason: 'wrong' },
      { action: 'B', reason: 'right' },
      '/api',
    )
    manager.record('exploit_proof',
      { action: 'C', reason: 'failed' },
      { action: 'D', reason: 'worked' },
      '/api',
    )
    expect(manager.getBySource('user_correction')).toHaveLength(1)
    expect(manager.getBySource('exploit_proof')).toHaveLength(1)
  })

  it('exports as DPO format', () => {
    manager.record('user_correction',
      { action: 'GET', reason: 'wrong method' },
      { action: 'POST', reason: 'correct method' },
      '/api/users',
    )
    const dpo = manager.exportDPO()
    expect(dpo).toHaveLength(1)
    expect(dpo[0]).toHaveProperty('rejected')
    expect(dpo[0]).toHaveProperty('chosen')
    expect(dpo[0].rejected).toContain('wrong method')
  })

  it('persists and reloads', () => {
    manager.record('user_correction',
      { action: 'A', reason: 'wrong' },
      { action: 'B', reason: 'right' },
      '/api',
    )
    const manager2 = new PreferencesManager(testPath)
    expect(manager2.count()).toBe(1)
  })
})
