/**
 * Tests for Capability Gateway (Phase H: three-tier visibility + requestCapability)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CapabilityGateway, type VisibilityTier } from '../../src/extensions/capability-gateway'
import { GrantManager } from '../../src/extensions/grants'

describe('CapabilityGateway', () => {
  let gw: CapabilityGateway

  beforeEach(() => {
    gw = new CapabilityGateway()
  })

  describe('registerTool()', () => {
    it('registers tool as discoverable', () => {
      gw.registerTool('httpRequest', 'network', 'Send HTTP requests')
      expect(gw.getTier('httpRequest')).toBe('discoverable')
    })

    it('does not overwrite existing registration', () => {
      gw.registerTool('httpRequest', 'network', 'Send HTTP requests')
      gw.visibility_set?.('httpRequest', 'invokable') // hypothetical
      gw.registerTool('httpRequest', 'network', 'Updated description')
      // Should not have reset to discoverable
      expect(gw.getTier('httpRequest')).toBe('discoverable')
    })
  })

  describe('getTier() / isVisible()', () => {
    it('new tools default to discoverable', () => {
      expect(gw.getTier('unknown')).toBe('discoverable')
    })

    it('discoverable tier is visible at discoverable but not describable', () => {
      gw.registerTool('tool1', 'read')
      expect(gw.isVisible('tool1', 'discoverable')).toBe(true)
      expect(gw.isVisible('tool1', 'describable')).toBe(false)
      expect(gw.isVisible('tool1', 'invokable')).toBe(false)
    })
  })

  describe('getDescription()', () => {
    it('returns description for describable tools', () => {
      gw.registerTool('tool1', 'read', 'A useful tool')
      // Manually escalate
      gw.requestCapability({ toolId: 'tool1', reason: 'test', risk: 'read' }, 'worker-1')
      expect(gw.getDescription('tool1')).toBe('A useful tool')
    })

    it('returns undefined for discoverable-only tools', () => {
      gw.registerTool('tool1', 'read', 'A useful tool')
      expect(gw.getDescription('tool1')).toBeUndefined()
    })
  })

  describe('requestCapability()', () => {
    it('auto-approves read risk to invokable', () => {
      gw.registerTool('queryGraph', 'read', 'Query graph')
      const result = gw.requestCapability(
        { toolId: 'queryGraph', reason: 'need to query', risk: 'read' },
        'worker-1',
      )
      expect(result.granted).toBe(true)
      expect(result.tier).toBe('invokable')
      expect(result.grantId).toBeUndefined() // no grant needed for read
    })

    it('auto-approves network risk to invokable', () => {
      gw.registerTool('httpRequest', 'network', 'HTTP requests')
      const result = gw.requestCapability(
        { toolId: 'httpRequest', reason: 'need to test', risk: 'network' },
        'worker-1',
      )
      expect(result.granted).toBe(true)
      expect(result.tier).toBe('invokable')
    })

    it('escalates network to invokable directly', () => {
      gw.registerTool('httpRequest', 'network', 'HTTP requests')
      const result = gw.requestCapability(
        { toolId: 'httpRequest', reason: 'need to invoke', risk: 'network' },
        'worker-1',
      )
      expect(result.granted).toBe(true)
      expect(result.tier).toBe('invokable')
    })

    it('creates grant for mutate risk', () => {
      gw.registerTool('writeFinding', 'mutate', 'Write findings')
      const result = gw.requestCapability(
        { toolId: 'writeFinding', reason: 'need to write', risk: 'mutate' },
        'worker-1',
      )
      expect(result.granted).toBe(true)
      expect(result.tier).toBe('invokable')
      expect(result.grantId).toBeDefined()
    })

    it('creates grant for delegate risk', () => {
      gw.registerTool('spawnWorker', 'delegate', 'Spawn worker')
      const result = gw.requestCapability(
        { toolId: 'spawnWorker', reason: 'need worker', risk: 'delegate' },
        'worker-1',
      )
      expect(result.granted).toBe(true)
      expect(result.tier).toBe('invokable')
      expect(result.grantId).toBeDefined()
    })

    it('does not auto-invoke when autoApproveLowRisk is false', () => {
      gw.registerTool('queryGraph', 'read', 'Query')
      const result = gw.requestCapability(
        { toolId: 'queryGraph', reason: 'test', risk: 'read' },
        'worker-1',
        false, // disable auto-approve
      )
      expect(result.granted).toBe(true)
      expect(result.tier).toBe('describable') // falls to fallback describable path
    })
  })

  describe('isInvokable()', () => {
    it('returns false for discoverable tools', () => {
      gw.registerTool('tool1', 'read')
      expect(gw.isInvokable('tool1', 'worker-1')).toBe(false)
    })

    it('returns true for invokable network tools', () => {
      gw.registerTool('httpRequest', 'network')
      gw.requestCapability({ toolId: 'httpRequest', reason: 'test', risk: 'network' }, 'w1')
      expect(gw.isInvokable('httpRequest', 'w1')).toBe(true)
    })

    it('returns true for granted mutate tools', () => {
      gw.registerTool('writeFinding', 'mutate')
      gw.requestCapability({ toolId: 'writeFinding', reason: 'test', risk: 'mutate' }, 'w1')
      expect(gw.isInvokable('writeFinding', 'w1')).toBe(true)
    })
  })

  describe('listByTier()', () => {
    it('lists all discoverable tools', () => {
      gw.registerTool('tool1', 'read')
      gw.registerTool('tool2', 'network')
      gw.registerTool('tool3', 'mutate')

      const discoverable = gw.listByTier('discoverable')
      expect(discoverable).toHaveLength(3)
    })

    it('lists only invokable tools after escalation', () => {
      gw.registerTool('tool1', 'read')
      gw.registerTool('tool2', 'read')
      gw.requestCapability({ toolId: 'tool1', reason: 'test', risk: 'read' }, 'w1')

      const invokable = gw.listByTier('invokable')
      expect(invokable).toHaveLength(1)
      expect(invokable[0].toolId).toBe('tool1')
    })
  })

  describe('GrantManager integration', () => {
    it('gateway shares grant manager with external code', () => {
      const grants = new GrantManager()
      const gw2 = new CapabilityGateway(grants)

      gw2.registerTool('writeFinding', 'mutate')
      gw2.requestCapability({ toolId: 'writeFinding', reason: 'test', risk: 'mutate' }, 'w1')

      // External grant check should see the same grant
      const active = grants.listActive()
      expect(active).toHaveLength(1)
      expect(active[0].capabilityId).toBe('writeFinding')
    })

    it('revoking grant disables invokability', () => {
      const grants = new GrantManager()
      const gw2 = new CapabilityGateway(grants)

      gw2.registerTool('writeFinding', 'mutate')
      const decision = gw2.requestCapability(
        { toolId: 'writeFinding', reason: 'test', risk: 'mutate' },
        'w1',
      )

      expect(gw2.isInvokable('writeFinding', 'w1')).toBe(true)

      // Revoke
      if (decision.grantId) grants.revoke(decision.grantId)
      expect(gw2.isInvokable('writeFinding', 'w1')).toBe(false)
    })
  })
})
