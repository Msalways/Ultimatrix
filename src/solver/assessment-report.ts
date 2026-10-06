import type { CampaignResult, CoverageStatus } from '../campaign/types'

export interface AssessmentReportInput {
  discovery: {
    pages: number
    endpoints: number
    inputs: number
    /** Observed ordered multi-request workflows, excluding route-only inference. */
    workflows: number
    authFlows: number
    roles: number
  }
  research?: {
    entities: number
    businessLogicFacts?: number
    hypotheses: ReadonlyArray<{ kind: string }>
    experiments: ReadonlyArray<{ status: string }>
  }
  spiderEnabled: boolean
  observation?: { status: 'completed' | 'failed'; requests?: number }
  crawl?: { stopReason?: string; pagesSeen?: number; frontierRemaining?: number }
  researchBootstrapIncomplete?: boolean
  campaignEnabled: boolean
  campaign?: CampaignResult
  campaignError?: string
  solverReason: string
  tasks?: ReadonlyArray<{ taskId: string; status: string }>
}

export interface AssessmentReport {
  status: 'complete' | 'partial'
  discovery: AssessmentReportInput['discovery'] & {
    observedRequests?: number
    crawl?: AssessmentReportInput['crawl']
    unknowns: string[]
  }
  targetModel: {
    entities: number
    businessLogicFacts: number
    hypotheses: number
    hypothesesByKind: Record<string, number>
    experimentsByStatus: Record<string, number>
  }
  testedCoverage: {
    status: CampaignResult['status'] | 'not_run'
    planned: number
    executed: number
    confirmed: number
    remaining: number
    requestsUsed: number
    budgetExceeded: boolean
    unitOutcomes: Partial<Record<CoverageStatus, number>>
    workflowUnits: Partial<Record<CoverageStatus, number>>
    businessLogicUnits: Partial<Record<CoverageStatus, number>>
    dimensions: {
      endpoints: { covered: number; total: number }
      inputs: { covered: number; total: number }
      actors: { covered: number; total: number }
      roles: { covered: number; total: number }
      states: { covered: number; total: number }
      techniques: { planned: number; total: number }
    }
  }
  blockers: string[]
  remainingWork: string[]
}

/** Summarizes only observed runtime state; missing stages lower status instead of being inferred as complete. */
export function buildAssessmentReport(input: AssessmentReportInput): AssessmentReport {
  const blockers: string[] = []
  const remainingWork: string[] = []
  const campaign = input.campaign
  const unitOutcomes: Partial<Record<CoverageStatus, number>> = {}
  const workflowUnits: Partial<Record<CoverageStatus, number>> = {}
  const businessLogicUnits: Partial<Record<CoverageStatus, number>> = {}
  for (const unit of campaign?.units ?? []) {
    unitOutcomes[unit.status] = (unitOutcomes[unit.status] ?? 0) + 1
    const outcomes = unit.technique === 'workflowBypass'
      ? workflowUnits
      : ['businessLogicAbuse', 'invariantProbe', 'concurrencyHarness'].includes(unit.technique)
        ? businessLogicUnits
        : undefined
    if (outcomes) outcomes[unit.status] = (outcomes[unit.status] ?? 0) + 1
  }
  const hypothesesByKind: Record<string, number> = {}
  for (const hypothesis of input.research?.hypotheses ?? []) {
    hypothesesByKind[hypothesis.kind] = (hypothesesByKind[hypothesis.kind] ?? 0) + 1
  }
  const experimentsByStatus: Record<string, number> = {}
  for (const experiment of input.research?.experiments ?? []) {
    experimentsByStatus[experiment.status] = (experimentsByStatus[experiment.status] ?? 0) + 1
  }
  const unresolvedExperiments = (input.research?.experiments ?? []).filter(experiment => experiment.status !== 'rejected')
  if (unresolvedExperiments.length > 0) {
    const unresolvedStatuses = Object.entries(experimentsByStatus)
      .filter(([status]) => status !== 'rejected')
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ')
    blockers.push(`${unresolvedExperiments.length} target research experiment(s) remain unresolved.`)
    remainingWork.push(`Research experiments need execution or fresh verification (${unresolvedStatuses}).`)
  }

  if (!input.observation) blockers.push('Baseline target observation did not complete.')
  else if (input.observation.status === 'failed') blockers.push('Baseline target observation failed.')

  if (input.researchBootstrapIncomplete) blockers.push('Target workflow and hypothesis learning did not complete.')

  if (!input.spiderEnabled) {
    blockers.push('Adaptive route and workflow crawl was disabled.')
  } else if (!input.crawl) {
    blockers.push('Adaptive route and workflow crawl did not complete.')
  } else if (input.crawl.stopReason !== 'frontier_exhausted') {
    blockers.push(`Adaptive crawl stopped before exhausting its frontier${input.crawl.stopReason ? ` (${input.crawl.stopReason})` : ''}.`)
  }

  if (!input.campaignEnabled) {
    blockers.push('Deterministic coverage campaign was disabled.')
  } else if (!campaign) {
    blockers.push(input.campaignError ? 'Deterministic coverage campaign failed.' : 'Deterministic coverage campaign did not run.')
  } else {
    if (campaign.status === 'partial') blockers.push('Deterministic coverage left planned work unresolved.')
    if (campaign.budgetExceeded) blockers.push('Deterministic coverage reached its request or time budget.')
    if (campaign.remainingSlices.length > 0) {
      remainingWork.push(`${campaign.remainingSlices.length} coverage slice(s) remain.`)
    }
    if (campaign.units.some(unit => unit.status === 'blocked')) {
      remainingWork.push(`${unitOutcomes.blocked ?? 0} coverage unit(s) are blocked.`)
    }
  }

  const incompleteReasons = new Set([
    'budget_reached', 'interrupted', 'stale', 'context_blocked', 'grounding_failed',
    'model_failed', 'tool_unavailable', 'browser_failed', 'tool_failed',
  ])
  if (incompleteReasons.has(input.solverReason)) {
    blockers.push(`Solver stopped with reason: ${input.solverReason}.`)
  }

  const unfinishedTasks = (input.tasks ?? []).filter(task => task.status !== 'completed')
  if (unfinishedTasks.length > 0) {
    blockers.push(`${unfinishedTasks.length} worker task(s) did not complete.`)
    remainingWork.push(...unfinishedTasks.slice(0, 10).map(task => `Worker task ${task.taskId}: ${task.status}.`))
  }

  return {
    status: blockers.length === 0 ? 'complete' : 'partial',
    discovery: {
      ...input.discovery,
      ...(input.observation?.status === 'completed' ? { observedRequests: input.observation.requests } : {}),
      ...(input.crawl ? { crawl: input.crawl } : {}),
      unknowns: [
        'Routes not observed or linked from the target remain unknown.',
        'Coverage is limited to actors, inputs, and states observed or available in this engagement.',
        'Campaign actor coverage alone does not verify cross-account authorization; that requires a victim and a separate attacker identity.',
        'Observed business-logic facts do not by themselves establish allowed action counts, quotas, or enforcement; verify stated limits with an actor-matched baseline and measured state transition.',
      ],
    },
    targetModel: {
      entities: input.research?.entities ?? 0,
      businessLogicFacts: input.research?.businessLogicFacts ?? 0,
      hypotheses: input.research?.hypotheses.length ?? 0,
      hypothesesByKind,
      experimentsByStatus,
    },
    testedCoverage: {
      status: campaign?.status ?? 'not_run',
      planned: campaign?.coverage.slicesPlanned ?? 0,
      executed: campaign?.coverage.slicesExecuted ?? 0,
      confirmed: campaign?.coverage.slicesConfirmed ?? 0,
      remaining: campaign?.remainingSlices.length ?? 0,
      requestsUsed: campaign?.requestsUsed ?? 0,
      budgetExceeded: campaign?.budgetExceeded ?? false,
      unitOutcomes,
      workflowUnits,
      businessLogicUnits,
      dimensions: {
        endpoints: { covered: campaign?.coverage.endpointsCovered ?? 0, total: campaign?.coverage.endpointsTotal ?? 0 },
        inputs: { covered: campaign?.coverage.paramsCovered ?? 0, total: campaign?.coverage.paramsTotal ?? 0 },
        actors: { covered: campaign?.coverage.actorsCovered ?? 0, total: campaign?.coverage.actorsTotal ?? 0 },
        roles: { covered: campaign?.coverage.rolesCovered ?? 0, total: campaign?.coverage.rolesTotal ?? 0 },
        states: { covered: campaign?.coverage.statesCovered ?? 0, total: campaign?.coverage.statesTotal ?? 0 },
        techniques: { planned: campaign?.coverage.techniquesPlanned ?? 0, total: campaign?.coverage.techniquesTotal ?? 0 },
      },
    },
    blockers,
    remainingWork,
  }
}
