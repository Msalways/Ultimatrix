import { describe, it, expect, beforeEach } from 'vitest'
import { isUrlInScope, setScopeConfig, getScopeConfig, setAllowAny, deriveScopeFromTarget, enforceHttpMethod, enforceAction } from '../../src/safety/scope-guard'
import type { ScopeConfig } from '../../src/config'

const baseConfig: ScopeConfig = {
  allowedDomains: ['example.com', '*.test.com'],
  enforcement: 'hard',
}

describe('isUrlInScope', () => {
  beforeEach(() => {
    setAllowAny(false)
    setScopeConfig(null)
  })

  it('allows all URLs when no config is set (free-for-all by default)', () => {
    setScopeConfig(null)
    setAllowAny(false)
    const r = isUrlInScope('https://evil.com/payload')
    expect(r.allowed).toBe(true)
  })

  it('allows all URLs when --allow-any is set', () => {
    setScopeConfig(null)
    setAllowAny(true)
    expect(isUrlInScope('https://evil.com/payload').allowed).toBe(true)
    setAllowAny(false)
  })

  it('explicit allowAny override wins over the ambient global flag', () => {
    setAllowAny(true)
    expect(isUrlInScope('https://evil.com/payload', baseConfig, { allowAny: false }).allowed).toBe(false)
    setAllowAny(false)
    expect(isUrlInScope('https://evil.com/payload', baseConfig, { allowAny: true }).allowed).toBe(true)
    expect(isUrlInScope('https://evil.com/payload', baseConfig).allowed).toBe(false)
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

  it('allows all URLs when allowedDomains is empty (free-for-all)', () => {
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

describe('deriveScopeFromTarget', () => {
  it('derives allowedDomains from target hostname', () => {
    const scope = deriveScopeFromTarget('https://example.com')
    expect(scope).not.toBeNull()
    expect(scope!.allowedDomains).toEqual(['example.com'])
    expect(scope!.enforcement).toBe('hard')
  })

  it('extracts hostname from URL with path', () => {
    const scope = deriveScopeFromTarget('https://target.example.com/api/v1')
    expect(scope).not.toBeNull()
    expect(scope!.allowedDomains).toEqual(['target.example.com'])
  })

  it('preserves protocol from target URL', () => {
    const scope = deriveScopeFromTarget('http://insecure.example.com')
    expect(scope).not.toBeNull()
    expect(scope!.allowedProtocols).toEqual(['http'])
  })

  it('lowercases hostname', () => {
    const scope = deriveScopeFromTarget('https://EXAMPLE.COM')
    expect(scope).not.toBeNull()
    expect(scope!.allowedDomains).toEqual(['example.com'])
  })

  it('returns null for invalid URL', () => {
    expect(deriveScopeFromTarget('not-a-url')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(deriveScopeFromTarget('')).toBeNull()
  })

  it('derived scope allows target URL but blocks other domains', () => {
    const scope = deriveScopeFromTarget('https://example.com')
    expect(scope).not.toBeNull()
    expect(isUrlInScope('https://example.com/page', scope).allowed).toBe(true)
    expect(isUrlInScope('https://evil.com/payload', scope).allowed).toBe(false)
  })

  it('derived scope allows subdomains when target uses subdomain', () => {
    const scope = deriveScopeFromTarget('https://sub.example.com')
    expect(scope).not.toBeNull()
    // Exact hostname match (not wildcard)
    expect(isUrlInScope('https://sub.example.com/api', scope).allowed).toBe(true)
    expect(isUrlInScope('https://other.example.com/api', scope).allowed).toBe(false)
  })
})

describe('action authorization', () => {
  beforeEach(() => {
    setAllowAny(false)
    setScopeConfig({
      allowedDomains: ['example.com'],
      enforcement: 'hard',
      allowedCategories: ['read', 'browser_action'],
    })
  })

  it('enforces exact origins, ports, and path segments when configured', () => {
    setScopeConfig({
      allowedDomains: ['example.com'],
      allowedOrigins: ['https://example.com:8443'],
      allowedPorts: [8443],
      allowedPaths: ['/admin'],
      enforcement: 'hard',
      allowedCategories: ['read'],
    })
    expect(isUrlInScope('https://example.com:8443/admin/users').allowed).toBe(true)
    expect(isUrlInScope('https://example.com:8443/administrator').allowed).toBe(false)
    expect(isUrlInScope('https://example.com:9443/admin').allowed).toBe(false)
    expect(isUrlInScope('http://example.com:8443/admin').allowed).toBe(false)
  })

  it('blocks private IP literals unless explicitly allowed', () => {
    setScopeConfig({ allowedDomains: ['127.0.0.1'], enforcement: 'hard' })
    expect(isUrlInScope('http://127.0.0.1:3000/').allowed).toBe(false)
    setScopeConfig({ allowedDomains: ['127.0.0.1'], enforcement: 'hard', allowPrivateAddresses: true })
    expect(isUrlInScope('http://127.0.0.1:3000/').allowed).toBe(true)
  })

  it('maps read and mutating HTTP methods to configured categories', () => {
    expect(() => enforceHttpMethod('GET')).not.toThrow()
    expect(() => enforceHttpMethod('POST')).toThrow(/Action not authorized: create/)
    expect(() => enforceAction('browser_action')).not.toThrow()
  })
})
