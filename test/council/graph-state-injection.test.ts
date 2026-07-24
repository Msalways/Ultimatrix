import { describe, it, expect } from 'vitest'
import { buildGoalPrompt } from '../../src/council/orchestrator'
import type { IntelligenceContext } from '../../src/council/types'

describe('Council graph state injection', () => {
  it('includes Current Target State when graphState is present', () => {
    const ctx: IntelligenceContext = {
      graphState: {
        totalEndpoints: 47,
        totalFindings: 3,
        findingsBySeverity: { critical: 1, high: 1, medium: 1 },
        totalTests: 12,
        authFlows: 2,
        rbacRoles: 1,
        untestedActions: 8,
        totalCapturedHeaders: 12,
        endpoints: [
          { id: 'ep1', url: '/api/users', method: 'GET', params: 2, authRequired: true, headerCount: 5 },
          { id: 'ep2', url: '/api/admin', method: 'POST', params: 1, authRequired: true, headerCount: 3 },
        ],
      },
    }

    const prompt = buildGoalPrompt('Test for IDOR', '', undefined, undefined, 'strategist', ctx)
    expect(prompt).toContain('## Current Target State')
    expect(prompt).toContain('47 endpoints discovered')
    expect(prompt).toContain('3 findings')
    expect(prompt).toContain('critical=1, high=1, medium=1')
    expect(prompt).toContain('2 auth flows, 1 RBAC roles')
    expect(prompt).toContain('GET /api/users')
    expect(prompt).toContain('POST /api/admin')
  })

  it('includes Structural Overview when captureOverview is present', () => {
    const ctx: IntelligenceContext = {
      captureOverview: {
        endpointCount: 47,
        methodCounts: { GET: 30, POST: 17 },
        originCounts: { target: 45, self: 2 },
        edgeTypeCounts: { VALUE_ORIGIN: 8, REINGESTS: 3, CHAINED_FROM: 2 },
        endpoints: [
          { id: 'ep1', method: 'GET', url: '/api/users', origin: 'target', paramNames: ['id', 'q'], outgoingEdgeTypes: ['VALUE_ORIGIN'], incomingEdgeTypes: [] },
        ],
        truncated: false,
      },
    }

    const prompt = buildGoalPrompt('Test for IDOR', '', undefined, undefined, 'analyst', ctx)
    expect(prompt).toContain('## Structural Overview')
    expect(prompt).toContain('47 endpoints')
    expect(prompt).toContain('Edge types: VALUE_ORIGIN=8, REINGESTS=3, CHAINED_FROM=2')
    expect(prompt).toContain('GET /api/users')
  })

  it('does NOT include graph blocks when intelligenceContext is absent', () => {
    const prompt = buildGoalPrompt('Test for IDOR', '', undefined, undefined, 'strategist', undefined)
    expect(prompt).not.toContain('## Current Target State')
    expect(prompt).not.toContain('## Structural Overview')
  })

  it('includes both graphState and captureOverview when both present', () => {
    const ctx: IntelligenceContext = {
      graphState: {
        totalEndpoints: 5,
        totalFindings: 1,
        findingsBySeverity: { high: 1 },
        totalTests: 3,
        authFlows: 1,
        rbacRoles: 0,
        untestedActions: 2,
        totalCapturedHeaders: 3,
        endpoints: [],
      },
      captureOverview: {
        endpointCount: 5,
        methodCounts: { GET: 5 },
        originCounts: { target: 5, self: 0 },
        edgeTypeCounts: { VALUE_ORIGIN: 2 },
        endpoints: [],
        truncated: false,
      },
    }

    const prompt = buildGoalPrompt('Analyze data flows', '', undefined, undefined, 'analyst', ctx)
    expect(prompt).toContain('## Current Target State')
    expect(prompt).toContain('## Structural Overview')
  })
})
