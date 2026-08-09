import { describe, expect, it } from 'vitest'
import {
  AUTH_FLOW_IDENTITY_KINDS,
  anonymousIdentity,
  createReachability,
  identityForAuthFlow,
  makeIdentity,
  pushReachability,
  reachabilityKey,
} from '../../src/identity/reachability'

const TARGET = 'https://reach.example.com'

describe('identity helpers', () => {
  it('anonymousIdentity returns the typed anonymous context', () => {
    const anon = anonymousIdentity()
    expect(anon).toMatchObject({ id: 'anonymous', kind: 'anonymous', label: 'Anonymous' })
  })

  it('makeIdentity builds typed contexts with explicit role/tenant', () => {
    const admin = makeIdentity('admin', 'Admin', { roleName: 'Administrator', tenantId: 'tenant-7' })
    expect(admin.kind).toBe('admin')
    expect(admin.roleName).toBe('Administrator')
    expect(admin.tenantId).toBe('tenant-7')
    expect(admin.id).toContain('administrator')
  })

  it('identityForAuthFlow maps login-like flows to authenticated identities', () => {
    const auth = identityForAuthFlow('login', 'Customer Portal', 'https://reach.example.com/login')
    expect(auth.kind).toBe('authenticated')
    expect(auth.id).toBe('auth:login:https://reach.example.com/login')
  })

  it('identityForAuthFlow maps logout to anonymous', () => {
    const identity = identityForAuthFlow('logout', 'Logout', 'https://reach.example.com/logout')
    expect(identity.kind).toBe('anonymous')
    expect(identity.id).toBe('anonymous')
  })

  it('typed map covers the identity-changing flow kinds only', () => {
    expect(AUTH_FLOW_IDENTITY_KINDS.login).toBe('authenticated')
    expect(AUTH_FLOW_IDENTITY_KINDS.oauth).toBe('authenticated')
    expect(AUTH_FLOW_IDENTITY_KINDS.logout).toBe('anonymous')
    expect(AUTH_FLOW_IDENTITY_KINDS).not.toHaveProperty('refresh')
    expect(AUTH_FLOW_IDENTITY_KINDS).not.toHaveProperty('form-fill')
  })
})

describe('reachability records', () => {
  it('createReachability links identity to a typed resource', () => {
    const record = createReachability('wf-1', anonymousIdentity(), 'page', 'https://reach.example.com/', '2026-01-01T00:00:00.000Z')
    expect(record).toEqual({
      workflowId: 'wf-1',
      identityId: 'anonymous',
      resourceId: 'https://reach.example.com/',
      resourceType: 'page',
      reachedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('reachabilityKey is unique per identity+resource', () => {
    const a = { identityId: 'anonymous', resourceType: 'endpoint' as const, resourceId: 'https://x.example/api' }
    const b = { identityId: 'anonymous', resourceType: 'form' as const, resourceId: 'https://x.example/api' }
    const c = { identityId: 'auth', resourceType: 'endpoint' as const, resourceId: 'https://x.example/api' }
    expect(reachabilityKey(a)).not.toBe(reachabilityKey(b))
    expect(reachabilityKey(a)).not.toBe(reachabilityKey(c))
    expect(reachabilityKey(a)).toBe(reachabilityKey({ ...a }))
  })

  it('pushReachability dedupes exact observations and appends new ones', () => {
    const r1 = createReachability('wf-1', anonymousIdentity(), 'page', 'https://reach.example.com/')
    const r2 = createReachability('wf-1', anonymousIdentity(), 'page', 'https://reach.example.com/')
    const r3 = createReachability('wf-1', anonymousIdentity(), 'endpoint', 'https://reach.example.com/api')

    let records = pushReachability([], r1)
    records = pushReachability(records, r2)
    records = pushReachability(records, r3)

    expect(records).toHaveLength(2)
    expect(records.map((r) => `${r.resourceType}:${r.resourceId}`)).toEqual([
      'page:https://reach.example.com/',
      'endpoint:https://reach.example.com/api',
    ])
  })
})

describe('reachability keys of real targets', () => {
  it('distinguishes anonymous vs authenticated reach for the same endpoint', () => {
    const anonymousReach = createReachability('wf-1', anonymousIdentity(), 'endpoint', `${TARGET}/admin`)
    const adminReach = createReachability('wf-1', makeIdentity('admin', 'Admin', { roleName: 'Administrator' }), 'endpoint', `${TARGET}/admin`)
    expect(reachabilityKey(anonymousReach)).not.toBe(reachabilityKey(adminReach))
  })
})
