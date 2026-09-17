/**
 * Tests for GrantManager (Phase C: Risk Classification + Grants)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GrantManager, type CapabilityGrant, type CapabilityRisk } from '../../src/extensions/grants'

describe('GrantManager', () => {
  let manager: GrantManager

  beforeEach(() => {
    manager = new GrantManager()
  })

  describe('grant()', () => {
    it('creates a grant with correct fields', () => {
      const grant = manager.grant('worker-1', 'http.request', 'network')
      expect(grant.grantId).toMatch(/^grant-/)
      expect(grant.workerId).toBe('worker-1')
      expect(grant.capabilityId).toBe('http.request')
      expect(grant.risk).toBe('network')
      expect(grant.grantedAt).toBeGreaterThan(0)
      expect(grant.revokedAt).toBeUndefined()
    })

    it('sets expiresAt when ttlMs is provided', () => {
      const grant = manager.grant('worker-1', 'mutate.write', 'mutate', { ttlMs: 5000 })
      expect(grant.expiresAt).toBeDefined()
      expect(grant.expiresAt! - grant.grantedAt).toBe(5000)
    })

    it('does not set expiresAt when ttlMs is omitted', () => {
      const grant = manager.grant('worker-1', 'read-only', 'read')
      expect(grant.expiresAt).toBeUndefined()
    })

    it('generates unique grant IDs', () => {
      const g1 = manager.grant('w1', 'c1', 'read')
      const g2 = manager.grant('w2', 'c2', 'read')
      expect(g1.grantId).not.toBe(g2.grantId)
    })
  })

  describe('revoke()', () => {
    it('revokes an existing grant', () => {
      const grant = manager.grant('w1', 'c1', 'read')
      expect(manager.revoke(grant.grantId)).toBe(true)
      expect(manager.check(grant.grantId).valid).toBe(false)
      expect(manager.check(grant.grantId).reason).toBe('grant revoked')
    })

    it('returns false for unknown grant', () => {
      expect(manager.revoke('grant-nonexistent')).toBe(false)
    })
  })

  describe('revokeAllForWorker()', () => {
    it('revokes all grants for a worker', () => {
      manager.grant('w1', 'c1', 'read')
      manager.grant('w1', 'c2', 'network')
      manager.grant('w2', 'c1', 'read')

      const count = manager.revokeAllForWorker('w1')
      expect(count).toBe(2)

      // w2 still active
      const w2Grants = manager.listForWorker('w2')
      expect(w2Grants.length).toBe(1)
      expect(w2Grants[0].revokedAt).toBeUndefined()
    })

    it('returns 0 for unknown worker', () => {
      expect(manager.revokeAllForWorker('nonexistent')).toBe(0)
    })
  })

  describe('check()', () => {
    it('returns valid for active grant', () => {
      const grant = manager.grant('w1', 'c1', 'read')
      expect(manager.check(grant.grantId)).toEqual({ valid: true })
    })

    it('returns invalid for revoked grant', () => {
      const grant = manager.grant('w1', 'c1', 'read')
      manager.revoke(grant.grantId)
      expect(manager.check(grant.grantId).valid).toBe(false)
    })

    it('returns invalid for expired grant', async () => {
      const grant = manager.grant('w1', 'c1', 'read', { ttlMs: 1 })
      // Wait for expiry
      await new Promise(r => setTimeout(r, 5))
      expect(manager.check(grant.grantId).valid).toBe(false)
      expect(manager.check(grant.grantId).reason).toBe('grant expired')
    })

    it('returns invalid for unknown grant', () => {
      expect(manager.check('grant-unknown').valid).toBe(false)
      expect(manager.check('grant-unknown').reason).toBe('grant not found')
    })
  })

  describe('checkCapability()', () => {
    it('finds a valid grant for worker+capability', () => {
      manager.grant('w1', 'http.request', 'network')
      const result = manager.checkCapability('w1', 'http.request')
      expect(result.granted).toBe(true)
      expect(result.grant).toBeDefined()
    })

    it('rejects when no grant exists', () => {
      const result = manager.checkCapability('w1', 'http.request')
      expect(result.granted).toBe(false)
      expect(result.reason).toBe('no valid grant found')
    })

    it('rejects when grant is revoked', () => {
      const grant = manager.grant('w1', 'http.request', 'network')
      manager.revoke(grant.grantId)
      const result = manager.checkCapability('w1', 'http.request')
      expect(result.granted).toBe(false)
    })

    it('rejects when risk below minimum', () => {
      manager.grant('w1', 'c1', 'read')
      const result = manager.checkCapability('w1', 'c1', 'mutate')
      expect(result.granted).toBe(false)
      expect(result.reason).toContain('below required')
    })

    it('passes when risk meets minimum', () => {
      manager.grant('w1', 'c1', 'delegate')
      const result = manager.checkCapability('w1', 'c1', 'mutate')
      expect(result.granted).toBe(true)
    })

    it('passes when risk equals minimum', () => {
      manager.grant('w1', 'c1', 'mutate')
      const result = manager.checkCapability('w1', 'c1', 'mutate')
      expect(result.granted).toBe(true)
    })
  })

  describe('listForWorker()', () => {
    it('returns all grants for a worker', () => {
      manager.grant('w1', 'c1', 'read')
      manager.grant('w1', 'c2', 'network')
      manager.grant('w2', 'c1', 'read')

      const w1 = manager.listForWorker('w1')
      expect(w1.length).toBe(2)
      expect(w1.every(g => g.workerId === 'w1')).toBe(true)
    })

    it('returns empty for unknown worker', () => {
      expect(manager.listForWorker('nonexistent')).toEqual([])
    })
  })

  describe('listActive()', () => {
    it('returns only non-revoked, non-expired grants', async () => {
      const g1 = manager.grant('w1', 'c1', 'read')               // active
      const g2 = manager.grant('w1', 'c2', 'read', { ttlMs: 1 }) // will expire
      const g3 = manager.grant('w1', 'c3', 'read')               // will revoke
      manager.revoke(g3.grantId)

      await new Promise(r => setTimeout(r, 5))

      const active = manager.listActive()
      expect(active.length).toBe(1)
      expect(active[0].grantId).toBe(g1.grantId)
    })
  })

  describe('clear()', () => {
    it('removes all grants', () => {
      manager.grant('w1', 'c1', 'read')
      manager.grant('w2', 'c2', 'network')
      manager.clear()
      expect(manager.listActive()).toHaveLength(0)
    })
  })

  describe('static methods', () => {
    it('requiresGrant returns true for mutate and delegate', () => {
      expect(GrantManager.requiresGrant('mutate')).toBe(true)
      expect(GrantManager.requiresGrant('delegate')).toBe(true)
    })

    it('requiresGrant returns false for read and network', () => {
      expect(GrantManager.requiresGrant('read')).toBe(false)
      expect(GrantManager.requiresGrant('network')).toBe(false)
    })

    it('compareRisk orders correctly', () => {
      expect(GrantManager.compareRisk('read', 'network')).toBeLessThan(0)
      expect(GrantManager.compareRisk('delegate', 'read')).toBeGreaterThan(0)
      expect(GrantManager.compareRisk('mutate', 'mutate')).toBe(0)
    })
  })
})
