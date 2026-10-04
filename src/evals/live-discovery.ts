export type DiscoveryVariant = 'vulnerable' | 'control'
export type ActorCoverage = 'available' | 'blocked' | 'unknown'

export interface DiscoveryFinding {
  id: string
  type?: string
  endpoint: string
  method?: string
  param?: string
  description?: string
  severity: string
  confidence?: number
  confirmed?: boolean
  lifecycleStatus?: string
  experimentIds?: string[]
  proofCheck?: { passed?: boolean; evidenceRefs?: string[] }
}

export interface DiscoveryExperiment {
  id: string
  outcome?: { status?: string; proof?: { experimentId?: string; phase?: string; evidenceRefs?: string[] } }
  retest?: { outcome?: { status?: string; proof?: { experimentId?: string; phase?: string; evidenceRefs?: string[] } } }
}

export interface DiscoveryRunInput {
  variant: DiscoveryVariant
  findings: DiscoveryFinding[]
  experiments: DiscoveryExperiment[]
  candidates: Array<{ id: string; status?: string; blockers?: string[]; [key: string]: unknown }>
  requiresSecondActor: boolean
  secondActorAvailable: boolean
  untracedRequests: string[]
  requestCount?: number
  requestLimit?: number
  durationMs?: number
  durationLimitMs?: number
}

export interface DiscoveryRunScore {
  verifiedFindingIds: string[]
  candidateIds: string[]
  confirmedFindingCount: number
  actorCoverage: ActorCoverage
  unsupportedCrossActorFinding: boolean
  requestTraceComplete: boolean
  withinRequestBudget: boolean
  withinDurationBudget: boolean
}

function hasIndependentRetest(finding: DiscoveryFinding, experiments: DiscoveryExperiment[]): boolean {
  const ids = finding.experimentIds ?? []
  if (ids.length === 0) return false
  return ids.every(id => {
    const experiment = experiments.find(item => item.id === id)
    const initial = experiment?.outcome?.proof
    const retest = experiment?.retest?.outcome?.proof
    if (
      experiment?.outcome?.status !== 'proven' || experiment.retest?.outcome?.status !== 'proven' ||
      initial?.experimentId !== id || initial.phase !== 'initial' ||
      retest?.experimentId !== id || retest.phase !== 'retest' ||
      !initial.evidenceRefs?.length || !retest.evidenceRefs?.length
    ) return false
    const initialRefs = new Set(initial.evidenceRefs)
    return retest.evidenceRefs.every(ref => !initialRefs.has(ref)) &&
      initial.evidenceRefs.every(ref => ref.startsWith('ev_')) && retest.evidenceRefs.every(ref => ref.startsWith('ev_'))
  })
}

export function scoreDiscoveryRun(input: DiscoveryRunInput): DiscoveryRunScore {
  const verifiedFindingIds = input.findings.filter(finding =>
    finding.confirmed === true && finding.lifecycleStatus === 'verified' &&
    finding.proofCheck?.passed === true &&
    (finding.proofCheck.evidenceRefs ?? []).some(ref => ref.startsWith('ev_')) &&
    hasIndependentRetest(finding, input.experiments),
  ).map(finding => finding.id)

  const confirmedFindingCount = input.findings.filter(finding =>
    finding.confirmed === true || finding.lifecycleStatus === 'verified',
  ).length

  return {
    verifiedFindingIds,
    candidateIds: input.candidates.map(candidate => candidate.id),
    confirmedFindingCount,
    actorCoverage: input.requiresSecondActor
      ? input.secondActorAvailable ? 'available' : 'unknown'
      : 'available',
    unsupportedCrossActorFinding: input.requiresSecondActor && !input.secondActorAvailable && confirmedFindingCount > 0,
    requestTraceComplete: input.untracedRequests.length === 0,
    withinRequestBudget: input.requestCount === undefined || input.requestLimit === undefined || input.requestCount <= input.requestLimit,
    withinDurationBudget: input.durationMs === undefined || input.durationLimitMs === undefined || input.durationMs <= input.durationLimitMs,
  }
}

export interface DiscoveryBenchmarkScore {
  vulnerableRuns: number
  verifiedVulnerableRuns: number
  vulnerableThreshold: number
  vulnerablePass: boolean
  controlRuns: number
  confirmedControlFindings: number
  controlPass: boolean
  pass: boolean
}

export function scoreDiscoveryBenchmark(runs: Array<{ variant: DiscoveryVariant; score: DiscoveryRunScore }>): DiscoveryBenchmarkScore {
  const vulnerable = runs.filter(run => run.variant === 'vulnerable')
  const controls = runs.filter(run => run.variant === 'control')
  const vulnerableThreshold = Math.ceil(vulnerable.length * (7 / 9))
  const verifiedVulnerableRuns = vulnerable.filter(run => run.score.verifiedFindingIds.length > 0).length
  const confirmedControlFindings = controls.reduce((sum, run) => sum + run.score.confirmedFindingCount, 0)
  const vulnerablePass = vulnerable.length === 9 && verifiedVulnerableRuns >= 7
  const controlPass = controls.length === 9 && confirmedControlFindings === 0
  return {
    vulnerableRuns: vulnerable.length,
    verifiedVulnerableRuns,
    vulnerableThreshold: vulnerableThreshold || 7,
    vulnerablePass,
    controlRuns: controls.length,
    confirmedControlFindings,
    controlPass,
    pass: vulnerablePass && controlPass && runs.every(run =>
      run.score.requestTraceComplete && run.score.withinRequestBudget && run.score.withinDurationBudget,
    ),
  }
}
