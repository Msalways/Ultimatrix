import { describe, expect, it } from 'vitest'
import type { CampaignResult } from '../../src/campaign/types'
import { buildAssessmentReport } from '../../src/solver/assessment-report'

const coverage = {
  endpointsTotal: 2, endpointsCovered: 2, paramsTotal: 3, paramsCovered: 3,
  rolesTotal: 1, rolesCovered: 1, actorsTotal: 1, actorsCovered: 1,
  statesTotal: 1, statesCovered: 1, techniquesTotal: 2, techniquesPlanned: 2,
  slicesPlanned: 2, slicesExecuted: 2, slicesConfirmed: 1,
  humanHypothesesConsidered: 0,
}

function completeCampaign(overrides: Partial<CampaignResult> = {}): CampaignResult {
  return {
    findings: [], coverage, budgetExceeded: false, slicesRun: 2, status: 'complete',
    requestsUsed: 8, remainingSlices: [], domains: [],
    units: [
      { id: 'unit-1', domain: 'injection', endpoint: '/search', input: { name: 'q', location: 'query' }, actor: 'anonymous', state: 'baseline', technique: 'sql', status: 'confirmed' },
      { id: 'unit-2', domain: 'auth', endpoint: '/login', input: { name: 'email', location: 'json' }, actor: 'anonymous', state: 'baseline', technique: 'auth', status: 'tested' },
    ],
    ...overrides,
  } as CampaignResult
}

const observed = {
  pages: 3, endpoints: 4, inputs: 5, workflows: 1, authFlows: 1, roles: 2,
}

describe('assessment report', () => {
  it('marks complete only when observation, crawl, coverage, and tasks completed', () => {
    const report = buildAssessmentReport({
      discovery: observed,
      spiderEnabled: true,
      observation: { status: 'completed', requests: 12 },
      crawl: { stopReason: 'frontier_exhausted', pagesSeen: 3, frontierRemaining: 0 },
      campaignEnabled: true,
      campaign: completeCampaign(),
      solverReason: 'response_complete',
      tasks: [{ taskId: 'task-1', status: 'completed' }],
    })

    expect(report.status).toBe('complete')
    expect(report.discovery).toMatchObject({ ...observed, observedRequests: 12, endpoints: 4 })
    expect(report.discovery.unknowns).toHaveLength(4)
    expect(report.testedCoverage).toMatchObject({ status: 'complete', planned: 2, executed: 2, confirmed: 1, remaining: 0, requestsUsed: 8 })
    expect(report.testedCoverage.unitOutcomes).toEqual({ confirmed: 1, tested: 1 })
    expect(report.targetModel).toEqual({ entities: 0, businessLogicFacts: 0, hypotheses: 0, hypothesesByKind: {}, experimentsByStatus: {} })
    expect(report.testedCoverage.dimensions).toMatchObject({
      endpoints: { covered: 2, total: 2 },
      actors: { covered: 1, total: 1 },
      states: { covered: 1, total: 1 },
    })
    expect(report.discovery.unknowns).toEqual(expect.arrayContaining([expect.stringContaining('cross-account authorization')]))
    expect(report.discovery.unknowns).toEqual(expect.arrayContaining([expect.stringContaining('allowed action counts, quotas')]))
    expect(report.blockers).toEqual([])
  })

  it('summarizes the learned hypothesis classes and experiment states', () => {
    const report = buildAssessmentReport({
      discovery: observed,
      research: {
        entities: 2,
        businessLogicFacts: 4,
        hypotheses: [{ kind: 'workflow_bypass' }, { kind: 'workflow_bypass' }, { kind: 'idor' }],
        experiments: [{ status: 'planned' }, { status: 'blocked' }],
      },
      spiderEnabled: true,
      observation: { status: 'completed' },
      crawl: { stopReason: 'frontier_exhausted' },
      campaignEnabled: true,
      campaign: completeCampaign({
        units: [
          { id: 'workflow-candidate', domain: 'workflow', endpoint: '/finish', input: { name: '', location: 'endpoint' }, actor: 'user', state: 'baseline', technique: 'workflowBypass', status: 'candidate' },
          { id: 'business-rule-tested', domain: 'business', endpoint: '/limit', input: { name: 'code', location: 'body' }, actor: 'user', state: 'baseline', technique: 'businessLogicAbuse', status: 'tested' },
          { id: 'invariant-blocked', domain: 'business', endpoint: '/limit', input: { name: 'code', location: 'body' }, actor: 'user', state: 'baseline', technique: 'invariantProbe', status: 'blocked' },
        ],
      }),
      solverReason: 'response_complete',
    })

    expect(report.targetModel).toEqual({
      entities: 2,
      businessLogicFacts: 4,
      hypotheses: 3,
      hypothesesByKind: { workflow_bypass: 2, idor: 1 },
      experimentsByStatus: { planned: 1, blocked: 1 },
    })
    expect(report.testedCoverage.workflowUnits).toEqual({ candidate: 1 })
    expect(report.testedCoverage.businessLogicUnits).toEqual({ tested: 1, blocked: 1 })
  })

  it('keeps discovery, tested coverage, blockers, and remaining work distinct when incomplete', () => {
    const partialCampaign = completeCampaign({
      status: 'partial',
      budgetExceeded: true,
      remainingSlices: [{ id: 'slice-pending' } as CampaignResult['remainingSlices'][number]],
      units: [
        { id: 'unit-blocked', domain: 'auth', endpoint: '/account', input: { name: 'id', location: 'path' }, actor: 'member', state: 'authenticated', technique: 'access-control', status: 'blocked' },
      ],
    })
    const report = buildAssessmentReport({
      discovery: observed,
      spiderEnabled: true,
      observation: { status: 'failed' },
      crawl: { stopReason: 'max_pages', pagesSeen: 3, frontierRemaining: 2 },
      campaignEnabled: true,
      campaign: partialCampaign,
      solverReason: 'budget_reached',
      tasks: [{ taskId: 'worker-context', status: 'blocked' }],
    })

    expect(report.status).toBe('partial')
    expect(report.discovery).not.toHaveProperty('observedRequests')
    expect(report.discovery.crawl).toEqual({ stopReason: 'max_pages', pagesSeen: 3, frontierRemaining: 2 })
    expect(report.testedCoverage).toMatchObject({ status: 'partial', planned: 2, executed: 2, remaining: 1, budgetExceeded: true, unitOutcomes: { blocked: 1 } })
    expect(report.blockers).toEqual(expect.arrayContaining([
      'Baseline target observation failed.',
      'Adaptive crawl stopped before exhausting its frontier (max_pages).',
      'Deterministic coverage left planned work unresolved.',
      'Deterministic coverage reached its request or time budget.',
      'Solver stopped with reason: budget_reached.',
      '1 worker task(s) did not complete.',
    ]))
    expect(report.remainingWork).toEqual(expect.arrayContaining([
      '1 coverage slice(s) remain.',
      '1 coverage unit(s) are blocked.',
      'Worker task worker-context: blocked.',
    ]))
  })

  it('does not call an assessment complete when workflow and hypothesis learning failed', () => {
    const report = buildAssessmentReport({
      discovery: observed,
      spiderEnabled: true,
      observation: { status: 'completed', requests: 12 },
      crawl: { stopReason: 'frontier_exhausted', pagesSeen: 3, frontierRemaining: 0 },
      researchBootstrapIncomplete: true,
      campaignEnabled: true,
      campaign: completeCampaign(),
      solverReason: 'response_complete',
    })

    expect(report.status).toBe('partial')
    expect(report.blockers).toContain('Target workflow and hypothesis learning did not complete.')
  })

  it('reports disabled or missing stages as blockers instead of treating them as complete', () => {
    const report = buildAssessmentReport({
      discovery: { pages: 0, endpoints: 0, inputs: 0, workflows: 0, authFlows: 0, roles: 0 },
      spiderEnabled: false,
      campaignEnabled: false,
      solverReason: 'goal_achieved',
    })

    expect(report.status).toBe('partial')
    expect(report.testedCoverage.status).toBe('not_run')
    expect(report.blockers).toEqual(expect.arrayContaining([
      'Baseline target observation did not complete.',
      'Adaptive route and workflow crawl was disabled.',
      'Deterministic coverage campaign was disabled.',
    ]))
  })
})
