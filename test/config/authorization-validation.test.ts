import { describe, expect, it } from 'vitest'
import { validateConfig, loadConfig } from '../../src/config'
import { resolveEffectiveConfig } from '../../src/models/effective-config'

function base(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    creds: { openai: { apiKey: 'sk-test' } },
    modelTiers: {},
    ...overrides,
  } as any
}

const complete = {
  confirmed: true,
  method: 'bounty',
  target: 'https://example.com',
  timestamp: '2026-09-26T00:00:00.000Z',
}

function errorsFor(overrides: Record<string, unknown>): string {
  try {
    validateConfig(base(overrides))
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('authorization config validation', () => {
  it('accepts a complete authorization record and preserves consent', () => {
    expect(errorsFor({ authorization: complete })).toBe('')
    expect(validateConfig(base({ authorization: complete })).authorization.confirmed).toBe(true)
  })

  it('rejects type-level malformation outright', () => {
    expect(errorsFor({ authorization: { ...complete, confirmed: 'yes' } }))
      .toMatch(/authorization\.confirmed must be a boolean/)
    expect(errorsFor({ authorization: { ...complete, method: 'because-i-said-so' } }))
      .toMatch(/authorization\.method must be one of/)
    expect(errorsFor({ authorization: { ...complete, target: 'not a url' } }))
      .toMatch(/authorization\.target must be an absolute URL/)
    expect(errorsFor({ authorization: { ...complete, target: 'file:///etc/passwd' } }))
      .toMatch(/authorization\.target must be an http\(s\) URL/)
  })

  it('tolerates a placeholder outside bounty mode but never treats it as consent', () => {
    // This is the shape a local/lab config carries.
    const stub = { confirmed: true, method: 'self-owned', target: '', timestamp: '' }
    expect(errorsFor({ authorization: stub })).toBe('')
    const parsed = validateConfig(base({ authorization: stub }))
    expect(parsed.authorization.confirmed).toBe(false)
  })

  it('rejects an incomplete record once the bounty profile is enabled', () => {
    const stub = { confirmed: true, method: 'bounty', target: '', timestamp: '' }
    expect(errorsFor({ authorization: stub, bounty: { enabled: true } }))
      .toMatch(/authorization\.target must not be empty when bounty\.enabled is true/)
  })

  it('warns through config doctor so a placeholder is never silent', () => {
    const stub = { confirmed: true, method: 'self-owned', target: '', timestamp: '' }
    const config = validateConfig(base({ authorization: stub, modelRoles: {} }))
    const effective = resolveEffectiveConfig(config)
    expect(effective.warnings.join(' ')).toMatch(/not treated as consent/i)
  })

  it('does not warn once the record is genuinely complete', () => {
    const config = validateConfig(base({ authorization: complete, modelRoles: {} }))
    const effective = resolveEffectiveConfig(config)
    expect(effective.warnings.join(' ')).not.toMatch(/not treated as consent/i)
  })

  it('fails closed when bounty is enabled without confirmed authorization', () => {
    const stub = { confirmed: false, method: 'bounty', target: 'https://example.com', timestamp: '2026-09-26T00:00:00.000Z' }
    const config = validateConfig(base({ authorization: stub, bounty: { enabled: true } }))
    const effective = resolveEffectiveConfig(config)
    expect(effective.errors.join(' ')).toMatch(/bounty\.enabled is set but authorization is not a complete confirmed record/)
  })

  it('accepts a Date-shaped timestamp, as YAML actually parses it', () => {
    // `timestamp: 2026-09-26T09:15:00.000Z` in YAML arrives as a Date, not a
    // string. A typeof==='string' check rejects every real timestamp a bounty
    // operator writes while accepting the empty stub — exactly backwards.
    const asDate = { ...complete, timestamp: new Date('2026-09-26T09:15:00.000Z') as unknown as string }
    expect(errorsFor({ authorization: asDate })).toBe('')
    const parsed = validateConfig(base({ authorization: asDate }))
    expect(parsed.authorization.confirmed).toBe(true)
    expect(typeof parsed.authorization.timestamp).toBe('string')
    expect(parsed.authorization.timestamp).toBe('2026-09-26T09:15:00.000Z')
  })

  it('rejects an invalid Date-shaped timestamp', () => {
    const bad = { ...complete, timestamp: new Date('nope') as unknown as string }
    expect(errorsFor({ authorization: bad, bounty: { enabled: true } }))
      .toMatch(/parseable ISO-8601 timestamp/)
  })

  it('leaves the developer config loadable', () => {
    expect(() => loadConfig({ requireCredentials: false })).not.toThrow()
  })
})
