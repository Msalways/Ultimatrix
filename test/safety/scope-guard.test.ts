import { describe, it, expect } from 'vitest'
import { isUrlInScope, setScopeConfig, getScopeConfig } from '../../src/safety/scope-guard'
import type { ScopeConfig } from '../../src/config'

const baseConfig: ScopeConfig = {
  allowedDomains: ['example.com', '*.test.com'],
  enforcement: 'hard',
}

describe('isUrlInScope', () => {
  it('allows all URLs when no config is set', () => {
    setScopeConfig(null)
    const r = isUrlInScope('https://evil.com/payload')
    expect(r.allowed).toBe(true)
  })

  it('allows exact domain match', () => {
    const r = isUrlInScope('https://example.com/api', baseConfig)
    expect(r.allowed).toBe(true)
  })

  it('allows wildcard subdomain match', () => {
    const r = isUrlInScope('https://sub.test.com/page', baseConfig)
    expect(r.allowed).toBe(true)
  })

  it('allows bare wildcard domain', () => {
    const r = isUrlInScope('https://test.com/page', baseConfig)
    expect(r.allowed).toBe(true)
  })

  it('rejects non-matching domain', () => {
    const r = isUrlInScope('https://evil.com/payload', baseConfig)
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('evil.com')
  })

  it('rejects domain that only partially matches', () => {
    const r = isUrlInScope('https://notexample.com/api', baseConfig)
    expect(r.allowed).toBe(false)
  })

  it('rejects subdomain that doesn\'t match wildcard', () => {
    const r = isUrlInScope('https://sub.other.com/page', baseConfig)
    expect(r.allowed).toBe(false)
  })

  it('rejects non-allowed protocol', () => {
    const config: ScopeConfig = {
      ...baseConfig,
      allowedProtocols: ['https'],
    }
    const r = isUrlInScope('http://example.com/api', config)
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Protocol')
  })

  it('allows allowed protocol', () => {
    const config: ScopeConfig = {
      ...baseConfig,
      allowedProtocols: ['https', 'http'],
    }
    const r = isUrlInScope('http://example.com/api', config)
    expect(r.allowed).toBe(true)
  })

  it('rejects invalid URL', () => {
    const r = isUrlInScope('not-a-url', baseConfig)
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Invalid URL')
  })

  it('allows all domains when allowedDomains is empty', () => {
    const config: ScopeConfig = {
      allowedDomains: [],
      enforcement: 'hard',
    }
    const r = isUrlInScope('https://anything.com/path', config)
    expect(r.allowed).toBe(true)
  })

  it('checks path prefix when allowedPaths is set', () => {
    const config: ScopeConfig = {
      allowedDomains: ['example.com'],
      allowedPaths: ['/api', '/admin'],
      enforcement: 'hard',
    }
    expect(isUrlInScope('https://example.com/api/users', config).allowed).toBe(true)
    expect(isUrlInScope('https://example.com/admin/settings', config).allowed).toBe(true)
    expect(isUrlInScope('https://example.com/public/page', config).allowed).toBe(false)
  })

  it('allows all paths when allowedPaths is empty', () => {
    const config: ScopeConfig = {
      allowedDomains: ['example.com'],
      allowedPaths: [],
      enforcement: 'hard',
    }
    expect(isUrlInScope('https://example.com/anything', config).allowed).toBe(true)
  })

  it('case-insensitive domain matching', () => {
    const r = isUrlInScope('https://EXAMPLE.COM/api', baseConfig)
    expect(r.allowed).toBe(true)
  })

  it('uses global config when none provided', () => {
    setScopeConfig(baseConfig)
    expect(getScopeConfig()).toBe(baseConfig)
    const r = isUrlInScope('https://example.com/api')
    expect(r.allowed).toBe(true)
    const r2 = isUrlInScope('https://evil.com/payload')
    expect(r2.allowed).toBe(false)
    setScopeConfig(null)
  })
})
