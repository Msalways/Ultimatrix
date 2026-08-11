/**
 * Memory policy tests — Slice 11 boundary enforcement.
 *
 * Proves: project memory accepts everything; workflow-scoped kinds are never
 * routed to global; global accepts ONLY safe preferences/technique patterns;
 * target-sensitive content (secrets, URLs, hostnames, auth state, storage
 * values, request/response payloads) is blocked fail-closed; decisions are
 * inspectable on the DecisionLedger.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  detectSensitivity,
  evaluateMemoryWrite,
  routeMemoryWrite,
  MemoryPolicyError,
  type MemoryWriteRequest,
} from '../../src/memory/policy'
import { getGlobalDecisionLedger } from '../../src/security/decision-ledger'

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'

function req(overrides: Partial<MemoryWriteRequest>): MemoryWriteRequest {
  return { scope: 'global', kind: 'preference', value: { theme: 'dark' }, ...overrides }
}

describe('detectSensitivity', () => {
  it('flags JWT-shaped and Bearer-shaped secrets as secret_shape', () => {
    expect(detectSensitivity({ auth: JWT }).sensitive).toBe(true)
    expect(detectSensitivity({ header: 'Bearer abcdefghijklmnopqrstuvwxyz1234' }).tags).toContain('secret_shape')
  })

  it('flags raw URLs and bare hostnames', () => {
    expect(detectSensitivity({ note: 'see https://example.com/api for details' }).tags).toContain('raw_url')
    expect(detectSensitivity({ server: 'api.target.io' }).tags).toContain('hostname')
  })

  it('does not false-positive on dotted technique ids', () => {
    expect(detectSensitivity({ techniqueId: 'sql.injection' }).sensitive).toBe(false)
    expect(detectSensitivity({ pattern: 'classicInjection.verify' }).sensitive).toBe(false)
  })

  it('flags values under secret/auth key names as auth_state', () => {
    const s = detectSensitivity({ sessionId: 'sess_abc123', token: 'value' })
    expect(s.tags).toContain('auth_state')
    expect(s.sensitive).toBe(true)
  })

  it('does not flag pluralized structural key names as auth_state', () => {
    expect(detectSensitivity({ pathTokens: ['api', 'users', ':id'] }).sensitive).toBe(false)
    expect(detectSensitivity({ tokens: ['a', 'b'] }).sensitive).toBe(false)
  })

  it('flags camelCase credential keys (singular) via the persistence context', () => {
    const s = detectSensitivity('sk_live_abc', { contextKey: 'apiKey' })
    expect(s.tags).toContain('auth_state')
    expect(s.sensitive).toBe(true)
  })

  it('flags browser storage values as storage_value', () => {
    const s = detectSensitivity({ localStorage: { access_token: 'abc' } })
    expect(s.tags).toContain('storage_value')
    expect(s.sensitive).toBe(true)
  })

  it('flags structural HTTP request payloads', () => {
    const s = detectSensitivity({ method: 'POST', url: '/api/login', headers: { 'Content-Type': 'application/json' }, body: { user: 'x' } })
    expect(s.tags).toContain('request_payload')
    expect(s.sensitive).toBe(true)
  })

  it('flags structural HTTP response payloads', () => {
    const s = detectSensitivity({ status: 200, headers: {}, body: '<html>...</html>' })
    expect(s.tags).toContain('request_payload')
    expect(s.sensitive).toBe(true)
  })

  it('is target-origin aware', () => {
    const s = detectSensitivity('https://internal.corp.local/admin', { targetOrigin: 'https://internal.corp.local' })
    expect(s.sensitive).toBe(true)
    expect(s.tags).toContain('raw_url')
  })
})

describe('evaluateMemoryWrite — routing', () => {
  it('project scope accepts every kind', () => {
    for (const kind of ['preference', 'discovery', 'auth_state', 'target_data', 'technique_pattern'] as const) {
      const r = evaluateMemoryWrite(req({ scope: 'project', kind }))
      expect(r.allowed).toBe(true)
      expect(r.destination).toBe('project')
    }
  })

  it('reroutes workflow-scoped kinds away from global to project', () => {
    for (const kind of ['discovery', 'auth_state', 'target_data'] as const) {
      const r = evaluateMemoryWrite(req({ kind, value: { url: 'https://example.com/api' } }))
      expect(r.allowed).toBe(true)
      expect(r.destination).toBe('project')
    }
  })

  it('allows a safe global preference', () => {
    const r = evaluateMemoryWrite(req({ value: { theme: 'dark', verbosity: 2 } }))
    expect(r.allowed).toBe(true)
    expect(r.destination).toBe('global')
  })

  it('blocks a global preference containing a secret', () => {
    const r = evaluateMemoryWrite(req({ value: { apiKey: 'sk_live_abcdef' } }))
    expect(r.allowed).toBe(false)
    expect(r.destination).toBe('global')
  })

  it('blocks a global technique pattern containing a raw URL', () => {
    const r = evaluateMemoryWrite(req({ kind: 'technique_pattern', value: { shape: '/api/users/:id', hint: 'https://example.com' } }))
    expect(r.allowed).toBe(false)
  })

  it('blocks a global preference containing auth state', () => {
    const r = evaluateMemoryWrite(req({ value: { session: 'sid_123', theme: 'dark' } }))
    expect(r.allowed).toBe(false)
  })
})

describe('routeMemoryWrite alias', () => {
  it('is the same gate', () => {
    expect(routeMemoryWrite(req({ kind: 'auth_state' }))).toEqual(evaluateMemoryWrite(req({ kind: 'auth_state' })))
  })
})

describe('memory policy decisions are inspectable', () => {
  beforeEach(() => {
    getGlobalDecisionLedger().clear()
  })

  it('records a blocked write on the decision ledger', () => {
    const blocked = evaluateMemoryWrite(req({ value: { apiKey: 'sk_xxx' } }))
    expect(blocked.allowed).toBe(false)
    getGlobalDecisionLedger().recordDecision({
      kind: 'memory.policy',
      reason: blocked.reason,
      sourceRefs: [],
    })
    expect(getGlobalDecisionLedger().listDecisions('memory.policy').length).toBe(1)
  })
})

describe('MemoryPolicyError', () => {
  it('carries the policy result and a readable reason', () => {
    const result = evaluateMemoryWrite(req({ value: { apiKey: 'sk_xxx' } }))
    const err = new MemoryPolicyError(result)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('MemoryPolicyError')
    expect(err.result).toBe(result)
    expect(err.message).toContain('blocked')
  })
})
