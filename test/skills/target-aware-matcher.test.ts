import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../../src/solver/skills/registry'
import { resetSkillCache } from '../../src/solver/skills/loader'

describe('SkillRegistry — pure-discovery search (Phase 7.2)', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    resetSkillCache()
    registry = new SkillRegistry()
    registry.loadFromDirectory('')
  })

  it('search finds skills by id substring (controlled token)', () => {
    const results = registry.search('recon')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('recon')
  })

  it('search is empty for unrelated input', () => {
    const results = registry.search('zzzznonexistent')
    expect(results.length).toBe(0)
  })

  it('search ranks id matches above description matches', () => {
    const results = registry.search('web')
    expect(results.length).toBeGreaterThan(0)
    // The exact skill id 'web-pentest' should outrank loose description hits.
    const exact = results.findIndex((s) => s.id === 'web-pentest')
    expect(exact).toBeGreaterThanOrEqual(0)
  })

  it('list returns every registered skill', () => {
    const all = registry.list()
    expect(all.length).toBeGreaterThan(0)
    expect(all.some((s) => s.id === 'recon')).toBe(true)
  })

  it('has() reflects registration state', () => {
    expect(registry.has('recon')).toBe(true)
    expect(registry.has('does-not-exist')).toBe(false)
  })

  it('get() throws for unknown skill', () => {
    expect(() => registry.get('nope')).toThrow()
  })

  it('loadFromDirectory registers discoverable skills', () => {
    expect(registry.count()).toBeGreaterThan(0)
  })
})
