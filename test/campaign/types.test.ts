import { describe, it, expect, vi } from 'vitest'
import type { CampaignSlice, CoverageStats, PlanOptions, CampaignPlan } from '../../src/campaign/types'

describe('Campaign types', () => {
  it('CampaignSlice has correct shape', () => {
    const slice: CampaignSlice = {
      id: 'slice-1',
      endpoint: { id: 'ep-1', url: 'https://example.com/api', method: 'GET' },
      params: ['id'],
      role: 'anonymous',
      state: 'baseline',
      techniqueIds: ['classicInjection'],
      priority: 1,
    }
    expect(slice.id).toBe('slice-1')
    expect(slice.endpoint.method).toBe('GET')
    expect(slice.techniqueIds).toContain('classicInjection')
  })

  it('CoverageStats has all counters', () => {
    const stats: CoverageStats = {
      endpointsTotal: 5,
      endpointsCovered: 3,
      paramsTotal: 10,
      paramsCovered: 7,
      rolesTotal: 2,
      rolesCovered: 2,
      statesTotal: 1,
      statesCovered: 1,
      techniquesTotal: 9,
      techniquesPlanned: 9,
      slicesPlanned: 27,
      slicesExecuted: 0,
      slicesConfirmed: 0,
      humanHypothesesConsidered: 0,
    }
    expect(stats.endpointsTotal).toBe(5)
    expect(stats.slicesPlanned).toBe(27)
  })

  it('PlanOptions accepts primitives array', () => {
    const opts: PlanOptions = {
      primitives: [{ id: 'classicInjection', description: 'SQL injection' }],
      maxSlices: 50,
      includeAnonymous: true,
    }
    expect(opts.primitives).toHaveLength(1)
    expect(opts.maxSlices).toBe(50)
  })

  it('CampaignPlan contains all required fields', () => {
    const plan: CampaignPlan = {
      slices: [],
      coverage: {
        endpointsTotal: 0, endpointsCovered: 0,
        paramsTotal: 0, paramsCovered: 0,
        rolesTotal: 0, rolesCovered: 0,
        statesTotal: 0, statesCovered: 0,
        techniquesTotal: 0, techniquesPlanned: 0,
        slicesPlanned: 0, slicesExecuted: 0,
        slicesConfirmed: 0, humanHypothesesConsidered: 0,
      },
      generatedAt: Date.now(),
      options: { primitives: [] },
    }
    expect(plan.slices).toEqual([])
    expect(plan.generatedAt).toBeGreaterThan(0)
  })
})
