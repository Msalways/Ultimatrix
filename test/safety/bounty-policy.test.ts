import { describe, expect, it } from 'vitest'
import { enforceBountyPolicy, BountyPolicyError } from '../../src/safety/bounty-policy'

function config(overrides: Record<string, any> = {}): any {
  return {
    authorization: {
      confirmed: true,
      method: 'bounty',
      target: 'https://target.example/app',
      timestamp: '2026-09-25T00:00:00.000Z',
    },
    scope: {
      allowedDomains: ['target.example'],
      allowedOrigins: ['https://target.example'],
      allowedPorts: [443],
      enforcement: 'hard',
      allowedCategories: ['read', 'browser_action'],
    },
    budgetPolicy: { enforcement: 'hard' },
    rateLimit: { requestsPerMinute: 10, maxConcurrent: 1 },
    externalTools: { enabled: false },
    bounty: { enabled: true },
    ...overrides,
  }
}

describe('live bounty policy', () => {
  it('leaves ordinary lab engagements unchanged when disabled', () => {
    expect(enforceBountyPolicy(config({ bounty: { enabled: false } }), 'https://target.example/app')).toBeUndefined()
  })

  it('accepts a complete hard-scope authorization', () => {
    const policy = enforceBountyPolicy(config(), 'https://target.example/app')
    expect(policy).toMatchObject({
      allowedCategories: ['read', 'browser_action'],
      scope: { enforcement: 'hard' },
    })
  })

  it('rejects missing confirmation before creating an engagement', () => {
    expect(() => enforceBountyPolicy(config({ authorization: { ...config().authorization, confirmed: false } }), 'https://target.example/app'))
      .toThrow(BountyPolicyError)
  })

  it('rejects a target outside the explicit authorization and scope', () => {
    expect(() => enforceBountyPolicy(config(), 'https://other.example/app')).toThrow(/outside authorized origin/)
  })

  it('rejects allowAny and soft budgets', () => {
    expect(() => enforceBountyPolicy(config(), 'https://target.example/app', { allowAny: true })).toThrow(/allowAny/)
    expect(() => enforceBountyPolicy(config({ budgetPolicy: { enforcement: 'soft' } }), 'https://target.example/app')).toThrow(/budgetPolicy/)
  })

  it('requires explicit external-tool authorization when adapters are enabled', () => {
    expect(() => enforceBountyPolicy(config({ externalTools: { enabled: true } }), 'https://target.example/app'))
      .toThrow(/external tools are disabled/i)
  })
})
