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
  hypothesisId?: string
  hypothesisKind?: string
  status?: string
  targetEndpoints?: Array<{ method?: string; path: string }>
  executionEvidenceRefs?: string[]
  outcome?: { status?: string; evidenceRefs?: string[]; proof?: { experimentId?: string; phase?: string; evidenceRefs?: string[] } }
  retest?: { outcome?: { status?: string; evidenceRefs?: string[]; proof?: { experimentId?: string; phase?: string; evidenceRefs?: string[] } } }
}

export interface DiscoveryActorEvidence {
  /** Synthetic actor labels observed on successful logins or authenticated requests. */
  actorsObserved: string[]
  /** Requests where an authenticated actor addressed a record owned by another actor. */
  crossActorRequestCount: number
}

export interface DiscoveryTargetLearning {
  workflowCount: number
  entityCount: number
  hypothesisKinds: string[]
  experimentStatuses: string[]
  expectedEndpoints: Array<{ method: string; path: string }>
  observedEndpoints: Array<{ method: string; path: string }>
  expectedWorkflowSequences?: Array<Array<{ method: string; path: string }>>
  observedWorkflowSequences?: Array<Array<{ method: string; path: string }>>
}

export interface DiscoveryRunInput {
  variant: DiscoveryVariant
  findings: DiscoveryFinding[]
  experiments: DiscoveryExperiment[]
  candidates: Array<{ id: string; status?: string; blockers?: string[]; [key: string]: unknown }>
  requiresSecondActor: boolean
  secondActorAvailable: boolean
  actorEvidence?: DiscoveryActorEvidence
  observedEvidenceRefs?: string[]
  untracedRequests: string[]
  targetLearning?: DiscoveryTargetLearning
  expectedHypothesisKinds?: string[]
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
  actorEvidence: DiscoveryActorEvidence
  unsupportedCrossActorFinding: boolean
  requestTraceComplete: boolean
  withinRequestBudget: boolean
  withinDurationBudget: boolean
  targetLearning: {
    workflowCount: number
    entityCount: number
    expectedEndpointCount: number
    observedExpectedEndpointCount: number
    endpointRecall: number | null
    expectedWorkflowSequenceCount: number
    matchedWorkflowSequenceCount: number
    workflowSequenceRecall: number | null
    hypothesisKinds: string[]
    expectedHypothesisKinds: string[]
    matchedHypothesisKinds: string[]
    hypothesisRecall: number | null
    attackedHypothesisKinds: string[]
    attackedHypothesisRecall: number | null
    plannedExperiments: number
    attemptedExperiments: number
    completedExperiments: number
    blockedExperiments: number
  }
}

function hasIndependentRetest(finding: DiscoveryFinding, experiments: DiscoveryExperiment[], observedEvidenceRefs: Set<string>): boolean {
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
      initial.evidenceRefs.some(ref => observedEvidenceRefs.has(ref)) &&
      retest.evidenceRefs.some(ref => observedEvidenceRefs.has(ref)) &&
      initial.evidenceRefs.every(ref => ref.startsWith('ev_')) && retest.evidenceRefs.every(ref => ref.startsWith('ev_'))
  })
}

function hasAttemptEvidence(experiment: DiscoveryExperiment, observedEvidenceRefs: Set<string>): boolean {
  // Require the baseline and mutation response IDs to also occur in the
  // forensic HTTP trace; graph status and copied IDs alone are insufficient.
  const refs = [
    ...(experiment.executionEvidenceRefs ?? []),
    ...(experiment.outcome?.evidenceRefs ?? []),
    ...(experiment.outcome?.proof?.evidenceRefs ?? []),
  ]
  return new Set(refs.filter(ref => ref.startsWith('ev_') && observedEvidenceRefs.has(ref))).size >= 2
}

export function scoreDiscoveryRun(input: DiscoveryRunInput): DiscoveryRunScore {
  const observedEvidenceRefs = new Set((input.observedEvidenceRefs ?? []).filter(ref => ref.startsWith('ev_')))
  const verifiedFindingIds = input.findings.filter(finding =>
    finding.confirmed === true && finding.lifecycleStatus === 'verified' &&
    finding.proofCheck?.passed === true &&
    (finding.proofCheck.evidenceRefs ?? []).some(ref => observedEvidenceRefs.has(ref)) &&
    hasIndependentRetest(finding, input.experiments, observedEvidenceRefs),
  ).map(finding => finding.id)

  const confirmedFindingCount = input.findings.filter(finding =>
    finding.confirmed === true || finding.lifecycleStatus === 'verified',
  ).length
  const expectedHypothesisKinds = [...new Set(input.expectedHypothesisKinds ?? [])]
  const hypothesisKinds = [...new Set(input.targetLearning?.hypothesisKinds ?? [])]
  const matchedHypothesisKinds = expectedHypothesisKinds.filter(kind => hypothesisKinds.includes(kind))
  const experimentStatuses = input.targetLearning?.experimentStatuses ?? []
  const completedStatuses = new Set(['interesting', 'rejected'])
  const endpointKey = (endpoint: { method: string; path: string }) => `${endpoint.method.toUpperCase()} ${endpoint.path}`
  const observedEndpointKeys = new Set((input.targetLearning?.observedEndpoints ?? []).map(endpointKey))
  const expectedEndpoints = input.targetLearning?.expectedEndpoints ?? []
  const observedExpectedEndpointCount = expectedEndpoints.filter(endpoint => observedEndpointKeys.has(endpointKey(endpoint))).length
  const actorEvidence: DiscoveryActorEvidence = {
    actorsObserved: [...new Set(input.actorEvidence?.actorsObserved ?? [])].sort(),
    crossActorRequestCount: Math.max(0, input.actorEvidence?.crossActorRequestCount ?? 0),
  }
  const observedBothActors = actorEvidence.actorsObserved.includes('owner') && actorEvidence.actorsObserved.includes('peer')
  const actorCoverage: ActorCoverage = !input.requiresSecondActor
    ? 'available'
    : !input.secondActorAvailable
      ? 'unknown'
      : observedBothActors && actorEvidence.crossActorRequestCount > 0
        ? 'available'
        : 'blocked'
  const attackedHypothesisKinds = expectedHypothesisKinds.filter(kind => input.experiments.some(experiment =>
    experiment.hypothesisId
      && experiment.hypothesisKind === kind
      && hasAttemptEvidence(experiment, observedEvidenceRefs)
      && (experiment.targetEndpoints ?? []).some(target => expectedEndpoints.some(expected =>
        target.path === expected.path
        && (!target.method || target.method.toUpperCase() === expected.method.toUpperCase()),
      )),
  ))
  const expectedWorkflowSequences = input.targetLearning?.expectedWorkflowSequences ?? []
  const remainingObservedSequences = [...(input.targetLearning?.observedWorkflowSequences ?? [])]
  const matchedWorkflowSequenceCount = expectedWorkflowSequences.filter(expected => {
    const expectedKeys = expected.map(endpointKey)
    const matchIndex = remainingObservedSequences.findIndex(observed => {
      let expectedIndex = 0
      for (const step of observed) {
        if (endpointKey(step) === expectedKeys[expectedIndex]) expectedIndex += 1
        if (expectedIndex === expectedKeys.length) return true
      }
      return expectedKeys.length === 0
    })
    if (matchIndex < 0) return false
    remainingObservedSequences.splice(matchIndex, 1)
    return true
  }).length

  return {
    verifiedFindingIds,
    candidateIds: input.candidates.map(candidate => candidate.id),
    confirmedFindingCount,
    actorCoverage,
    actorEvidence,
    unsupportedCrossActorFinding: input.requiresSecondActor && !input.secondActorAvailable && confirmedFindingCount > 0,
    requestTraceComplete: input.untracedRequests.length === 0,
    withinRequestBudget: input.requestCount === undefined || input.requestLimit === undefined || input.requestCount <= input.requestLimit,
    withinDurationBudget: input.durationMs === undefined || input.durationLimitMs === undefined || input.durationMs <= input.durationLimitMs,
    targetLearning: {
      workflowCount: input.targetLearning?.workflowCount ?? 0,
      entityCount: input.targetLearning?.entityCount ?? 0,
      expectedEndpointCount: expectedEndpoints.length,
      observedExpectedEndpointCount,
      endpointRecall: expectedEndpoints.length ? observedExpectedEndpointCount / expectedEndpoints.length : null,
      expectedWorkflowSequenceCount: expectedWorkflowSequences.length,
      matchedWorkflowSequenceCount,
      workflowSequenceRecall: expectedWorkflowSequences.length
        ? matchedWorkflowSequenceCount / expectedWorkflowSequences.length
        : null,
      hypothesisKinds,
      expectedHypothesisKinds,
      matchedHypothesisKinds,
      hypothesisRecall: expectedHypothesisKinds.length ? matchedHypothesisKinds.length / expectedHypothesisKinds.length : null,
      attackedHypothesisKinds,
      attackedHypothesisRecall: expectedHypothesisKinds.length ? attackedHypothesisKinds.length / expectedHypothesisKinds.length : null,
      plannedExperiments: experimentStatuses.filter(status => status === 'planned').length,
      attemptedExperiments: input.experiments.filter(experiment => hasAttemptEvidence(experiment, observedEvidenceRefs)).length,
      completedExperiments: experimentStatuses.filter(status => completedStatuses.has(status)).length,
      blockedExperiments: experimentStatuses.filter(status => status === 'blocked').length,
    },
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
  targetLearning: {
    runs: number
    runsWithWorkflowMap: number
    runsWithCompleteEndpointMap: number
    averageEndpointRecall: number | null
    runsWithCompleteWorkflowSequences: number
    averageWorkflowSequenceRecall: number | null
    runsWithExpectedHypothesis: number
    averageHypothesisRecall: number | null
    runsWithExpectedAttacks: number
    averageAttackedHypothesisRecall: number | null
    runsWithPlannedExperiments: number
    runsWithAttemptedExperiments: number
    runsWithBlockedExperiments: number
    runsWithCompleteActorCoverage: number
    qualifiedVulnerableRuns: number
    qualifiedControlRuns: number
  }
  learningPass: boolean
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
  const learningScores = runs.map(run => run.score.targetLearning)
  const qualifiesAsLearnedAndAttacked = (run: { score: DiscoveryRunScore }) => {
    const score = run.score.targetLearning
    return run.score.actorCoverage === 'available'
      && score.workflowCount > 0 && score.endpointRecall === 1
      && score.hypothesisRecall === 1 && score.attackedHypothesisRecall === 1
      && score.attemptedExperiments > 0
      && (score.workflowSequenceRecall === null || score.workflowSequenceRecall === 1)
  }
  const qualifiedVulnerableRuns = vulnerable.filter(qualifiesAsLearnedAndAttacked).length
  const qualifiedControlRuns = controls.filter(qualifiesAsLearnedAndAttacked).length
  const learningPass = vulnerable.length === 9 && controls.length === 9 &&
    qualifiedVulnerableRuns >= Math.ceil(vulnerable.length * (7 / 9)) &&
    qualifiedControlRuns >= Math.ceil(controls.length * (7 / 9))
  const scoredHypothesisRuns = learningScores.filter(score => score.hypothesisRecall !== null)
  const scoredEndpointRuns = learningScores.filter(score => score.endpointRecall !== null)
  const scoredWorkflowRuns = learningScores.filter(score => score.workflowSequenceRecall !== null)
  return {
    vulnerableRuns: vulnerable.length,
    verifiedVulnerableRuns,
    vulnerableThreshold: vulnerableThreshold || 7,
    vulnerablePass,
    controlRuns: controls.length,
    confirmedControlFindings,
    controlPass,
    targetLearning: {
      runs: learningScores.length,
      runsWithWorkflowMap: learningScores.filter(score => score.workflowCount > 0).length,
      runsWithCompleteEndpointMap: learningScores.filter(score => score.endpointRecall === 1).length,
      averageEndpointRecall: scoredEndpointRuns.length
        ? scoredEndpointRuns.reduce((sum, score) => sum + (score.endpointRecall ?? 0), 0) / scoredEndpointRuns.length
        : null,
      runsWithCompleteWorkflowSequences: learningScores.filter(score => score.workflowSequenceRecall === 1).length,
      averageWorkflowSequenceRecall: scoredWorkflowRuns.length
        ? scoredWorkflowRuns.reduce((sum, score) => sum + (score.workflowSequenceRecall ?? 0), 0) / scoredWorkflowRuns.length
        : null,
      runsWithExpectedHypothesis: learningScores.filter(score => score.matchedHypothesisKinds.length > 0).length,
      averageHypothesisRecall: scoredHypothesisRuns.length
        ? scoredHypothesisRuns.reduce((sum, score) => sum + (score.hypothesisRecall ?? 0), 0) / scoredHypothesisRuns.length
        : null,
      runsWithExpectedAttacks: learningScores.filter(score => score.attackedHypothesisRecall === 1).length,
      averageAttackedHypothesisRecall: scoredHypothesisRuns.length
        ? scoredHypothesisRuns.reduce((sum, score) => sum + (score.attackedHypothesisRecall ?? 0), 0) / scoredHypothesisRuns.length
        : null,
      runsWithPlannedExperiments: learningScores.filter(score => score.plannedExperiments > 0).length,
      runsWithAttemptedExperiments: learningScores.filter(score => score.attemptedExperiments > 0).length,
      runsWithBlockedExperiments: learningScores.filter(score => score.blockedExperiments > 0).length,
      runsWithCompleteActorCoverage: runs.filter(run => run.score.actorCoverage === 'available').length,
      qualifiedVulnerableRuns,
      qualifiedControlRuns,
    },
    learningPass,
    pass: vulnerablePass && learningPass && controlPass && runs.every(run =>
      run.score.requestTraceComplete && run.score.withinRequestBudget && run.score.withinDurationBudget,
    ),
  }
}
