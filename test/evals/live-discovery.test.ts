import { afterEach, describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { makeConfig, makeFixture, mapExperiment, startTarget } from '../../scripts/live-discovery-benchmark'
import { validateConfig } from '../../src/config'
import { scoreDiscoveryBenchmark, scoreDiscoveryRun } from '../../src/evals/live-discovery'
import { isUrlInScope } from '../../src/safety/scope-guard'
import type { DiscoveryExperiment, DiscoveryFinding, DiscoveryRunScore } from '../../src/evals/live-discovery'

const targets: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(targets.splice(0).map(target => target.close()))
})

function successfulProof(): { finding: DiscoveryFinding; experiment: DiscoveryExperiment } {
  const id = 'experiment-1'
  return {
    finding: {
      id: 'finding-1', endpoint: 'http://127.0.0.1/private', severity: 'high',
      confirmed: true, lifecycleStatus: 'verified', experimentIds: [id],
      proofCheck: { passed: true, evidenceRefs: ['ev_1_1'] },
    },
    experiment: {
      id,
      outcome: { status: 'proven', proof: { experimentId: id, phase: 'initial', evidenceRefs: ['ev_1_1', 'ev_1_2'] } },
      retest: { outcome: { status: 'proven', proof: { experimentId: id, phase: 'retest', evidenceRefs: ['ev_1_3'] } } },
    },
  }
}

function score(variant: 'vulnerable' | 'control', overrides: Partial<Parameters<typeof scoreDiscoveryRun>[0]> = {}): DiscoveryRunScore {
  const proof = successfulProof()
  const targetLearning = overrides.targetLearning ?? {
    workflowCount: 1,
    entityCount: 1,
    hypothesisKinds: ['workflow_bypass'],
    experimentStatuses: [variant === 'vulnerable' ? 'interesting' : 'rejected'],
    expectedEndpoints: [{ method: 'POST', path: '/private' }],
    observedEndpoints: [{ method: 'POST', path: '/private' }],
  }
  const expectedHypothesisKinds = overrides.expectedHypothesisKinds ?? ['workflow_bypass']
  const targetEndpoint = targetLearning.expectedEndpoints[0]
  const experiments = expectedHypothesisKinds.map((kind, index) => ({
    ...(variant === 'vulnerable' && index === 0 ? proof.experiment : { id: `experiment-${index + 1}` }),
    hypothesisId: `hypothesis-${kind}`,
    hypothesisKind: kind,
    status: 'rejected',
    targetEndpoints: targetEndpoint ? [targetEndpoint] : [],
  }))
  return scoreDiscoveryRun({
    variant,
    findings: variant === 'vulnerable' ? [proof.finding] : [],
    experiments,
    candidates: [],
    requiresSecondActor: false,
    secondActorAvailable: true,
    untracedRequests: [],
    expectedHypothesisKinds,
    targetLearning,
    ...overrides,
  })
}

describe('live discovery scoring', () => {
  it('counts only verified findings with proof and a fresh independent retest', () => {
    expect(score('vulnerable').verifiedFindingIds).toEqual(['finding-1'])
    const proof = successfulProof()
    proof.experiment.retest!.outcome!.proof!.evidenceRefs = ['ev_1_1']
    const blocked = scoreDiscoveryRun({
      variant: 'vulnerable', findings: [proof.finding], experiments: [proof.experiment], candidates: [],
      requiresSecondActor: false, secondActorAvailable: true, untracedRequests: [],
    })
    expect(blocked.verifiedFindingIds).toEqual([])
  })

  it('keeps candidates separate and marks unavailable cross-account coverage unknown', () => {
    const result = scoreDiscoveryRun({
      variant: 'vulnerable', findings: [], experiments: [], candidates: [{ id: 'candidate-1', status: 'candidate' }],
      requiresSecondActor: true, secondActorAvailable: false, untracedRequests: [],
    })
    expect(result.actorCoverage).toBe('unknown')
    expect(result.verifiedFindingIds).toEqual([])
    expect(result.candidateIds).toEqual(['candidate-1'])
    expect(result.unsupportedCrossActorFinding).toBe(false)
  })

  it('flags unsupported cross-account findings and untraced requests', () => {
    const proof = successfulProof()
    const result = scoreDiscoveryRun({
      variant: 'vulnerable', findings: [proof.finding], experiments: [proof.experiment], candidates: [],
      requiresSecondActor: true, secondActorAvailable: false, untracedRequests: ['GET /guessed'],
    })
    expect(result.actorCoverage).toBe('unknown')
    expect(result.unsupportedCrossActorFinding).toBe(true)
    expect(result.requestTraceComplete).toBe(false)
  })

  it('rejects request or duration budget overruns', () => {
    expect(score('vulnerable', { requestCount: 101, requestLimit: 100 }).withinRequestBudget).toBe(false)
    expect(score('vulnerable', { durationMs: 300_001, durationLimitMs: 300_000 }).withinDurationBudget).toBe(false)
  })

  it('scores learned workflow hypotheses and experiment planning separately from proof', () => {
    const result = scoreDiscoveryRun({
      variant: 'vulnerable', findings: [], experiments: [], candidates: [],
      requiresSecondActor: false, secondActorAvailable: true, untracedRequests: [],
      targetLearning: {
        workflowCount: 2,
        entityCount: 1,
        hypothesisKinds: ['workflow_bypass', 'idor'],
        experimentStatuses: ['planned', 'interesting', 'running', 'blocked', 'rejected'],
        expectedEndpoints: [{ method: 'GET', path: '/orders' }, { method: 'POST', path: '/orders' }],
        observedEndpoints: [{ method: 'get', path: '/orders' }],
      },
      expectedHypothesisKinds: ['workflow_bypass'],
    })

    expect(result.verifiedFindingIds).toEqual([])
    expect(result.targetLearning).toMatchObject({
      workflowCount: 2,
      entityCount: 1,
      expectedEndpointCount: 2,
      observedExpectedEndpointCount: 1,
      endpointRecall: 0.5,
      expectedHypothesisKinds: ['workflow_bypass'],
      matchedHypothesisKinds: ['workflow_bypass'],
      hypothesisRecall: 1,
      plannedExperiments: 1,
      attemptedExperiments: 3,
      completedExperiments: 2,
      blockedExperiments: 1,
    })
  })

  it('requires every fixture-specific hypothesis class for full learning recall', () => {
    const expectedHypothesisKinds = ['workflow_bypass', 'action_limit']
    const partial = score('vulnerable', {
      expectedHypothesisKinds,
      targetLearning: {
        workflowCount: 1,
        entityCount: 0,
        hypothesisKinds: ['workflow_bypass'],
        experimentStatuses: [],
        expectedEndpoints: [],
        observedEndpoints: [],
      },
    })
    const complete = score('vulnerable', {
      expectedHypothesisKinds,
      targetLearning: {
        workflowCount: 1,
        entityCount: 0,
        hypothesisKinds: expectedHypothesisKinds,
        experimentStatuses: [],
        expectedEndpoints: [],
        observedEndpoints: [],
      },
    })

    expect(partial.targetLearning).toMatchObject({
      matchedHypothesisKinds: ['workflow_bypass'],
      hypothesisRecall: 0.5,
    })
    expect(complete.targetLearning).toMatchObject({
      matchedHypothesisKinds: expectedHypothesisKinds,
      hypothesisRecall: 1,
    })
  })

  it('counts an expected attack only when its experiment targets an expected route', () => {
    const base = {
      variant: 'vulnerable' as const,
      findings: [],
      candidates: [],
      requiresSecondActor: false,
      secondActorAvailable: true,
      untracedRequests: [],
      expectedHypothesisKinds: ['workflow_bypass'],
      targetLearning: {
        workflowCount: 1,
        entityCount: 0,
        hypothesisKinds: ['workflow_bypass'],
        experimentStatuses: ['rejected'],
        expectedEndpoints: [{ method: 'POST', path: '/checkout/finish' }],
        observedEndpoints: [{ method: 'POST', path: '/checkout/finish' }],
      },
    }
    const unrelated = scoreDiscoveryRun({
      ...base,
      experiments: [{
        id: 'experiment-unrelated', hypothesisId: 'hypothesis-1', hypothesisKind: 'workflow_bypass',
        status: 'rejected', targetEndpoints: [{ method: 'POST', path: '/profile/update' }],
      }],
    })
    const grounded = scoreDiscoveryRun({
      ...base,
      experiments: [{
        id: 'experiment-grounded', hypothesisId: 'hypothesis-1', hypothesisKind: 'workflow_bypass',
        status: 'rejected', targetEndpoints: [{ method: 'POST', path: '/checkout/finish' }],
      }],
    })

    expect(unrelated.targetLearning).toMatchObject({ attackedHypothesisKinds: [], attackedHypothesisRecall: 0 })
    expect(grounded.targetLearning).toMatchObject({ attackedHypothesisKinds: ['workflow_bypass'], attackedHypothesisRecall: 1 })
  })

  it('scores exact ordered workflow steps while allowing unrelated observed traffic between them', () => {
    const result = scoreDiscoveryRun({
      variant: 'vulnerable', findings: [], experiments: [], candidates: [],
      requiresSecondActor: false, secondActorAvailable: true, untracedRequests: [],
      targetLearning: {
        workflowCount: 1, entityCount: 0, hypothesisKinds: [], experimentStatuses: [],
        expectedEndpoints: [], observedEndpoints: [],
        expectedWorkflowSequences: [[
          { method: 'GET', path: '/one-time' },
          { method: 'POST', path: '/one-time' },
          { method: 'POST', path: '/one-time' },
        ]],
        observedWorkflowSequences: [[
          { method: 'GET', path: '/' },
          { method: 'GET', path: '/one-time' },
          { method: 'GET', path: '/favicon.ico' },
          { method: 'POST', path: '/one-time' },
          { method: 'POST', path: '/one-time' },
        ]],
      },
    })
    expect(result.targetLearning).toMatchObject({
      expectedWorkflowSequenceCount: 1, matchedWorkflowSequenceCount: 1, workflowSequenceRecall: 1,
    })

    const wrongOrder = scoreDiscoveryRun({
      variant: 'vulnerable', findings: [], experiments: [], candidates: [],
      requiresSecondActor: false, secondActorAvailable: true, untracedRequests: [],
      targetLearning: {
        workflowCount: 1, entityCount: 0, hypothesisKinds: [], experimentStatuses: [],
        expectedEndpoints: [], observedEndpoints: [],
        expectedWorkflowSequences: [[{ method: 'GET', path: '/one-time' }, { method: 'POST', path: '/one-time' }]],
        observedWorkflowSequences: [[{ method: 'POST', path: '/one-time' }, { method: 'GET', path: '/one-time' }]],
      },
    })
    expect(wrongOrder.targetLearning.workflowSequenceRecall).toBe(0)
  })

  it('requires nine vulnerable runs, at least seven independently proven, and zero confirmed controls', () => {
    const vulnerable = score('vulnerable')
    const control = score('control')
    const passing = scoreDiscoveryBenchmark([
      ...Array.from({ length: 7 }, () => ({ variant: 'vulnerable' as const, score: vulnerable })),
      ...Array.from({ length: 2 }, () => ({ variant: 'vulnerable' as const, score: { ...vulnerable, verifiedFindingIds: [] } })),
      ...Array.from({ length: 9 }, () => ({ variant: 'control' as const, score: control })),
    ])
    expect(passing.pass).toBe(true)
    expect(passing.learningPass).toBe(true)
    expect(passing.verifiedVulnerableRuns).toBe(7)
    expect(passing.targetLearning).toMatchObject({
      runs: 18, averageEndpointRecall: 1, averageHypothesisRecall: 1,
      runsWithExpectedAttacks: 18, averageAttackedHypothesisRecall: 1,
    })
    const falsePositive = scoreDiscoveryBenchmark([
      ...Array.from({ length: 9 }, () => ({ variant: 'vulnerable' as const, score: vulnerable })),
      ...Array.from({ length: 8 }, () => ({ variant: 'control' as const, score: control })),
      { variant: 'control', score: { ...control, confirmedFindingCount: 1 } },
    ])
    expect(falsePositive.controlPass).toBe(false)
    expect(falsePositive.pass).toBe(false)
  })

  it('does not count blocked or merely planned experiments as attacks', () => {
    const notAttacked = score('vulnerable', {
      targetLearning: {
        workflowCount: 1,
        entityCount: 1,
        hypothesisKinds: ['workflow_bypass'],
        experimentStatuses: ['planned', 'blocked'],
        expectedEndpoints: [],
        observedEndpoints: [],
      },
    })
    expect(notAttacked.targetLearning).toMatchObject({ plannedExperiments: 1, attemptedExperiments: 0, blockedExperiments: 1 })
  })

  it('requires target learning and an attempted experiment on vulnerable and control runs', () => {
    const incomplete = score('control', {
      targetLearning: {
        workflowCount: 0,
        entityCount: 0,
        hypothesisKinds: [],
        experimentStatuses: ['planned'],
        expectedEndpoints: [],
        observedEndpoints: [],
      },
      expectedHypothesisKinds: ['workflow_bypass'],
    })
    const result = scoreDiscoveryBenchmark([
      ...Array.from({ length: 9 }, () => ({ variant: 'vulnerable' as const, score: score('vulnerable') })),
      ...Array.from({ length: 9 }, () => ({ variant: 'control' as const, score: incomplete })),
    ])
    expect(result.learningPass).toBe(false)
    expect(result.pass).toBe(false)
    expect(result.targetLearning.qualifiedControlRuns).toBe(0)
  })

  it('does not qualify a run as learned when expected endpoint mapping is incomplete', () => {
    const incomplete = score('control', {
      targetLearning: {
        workflowCount: 1,
        entityCount: 1,
        hypothesisKinds: ['workflow_bypass'],
        experimentStatuses: ['rejected'],
        expectedEndpoints: [{ method: 'GET', path: '/private-random-route' }],
        observedEndpoints: [],
      },
    })
    const complete = score('control', {
      targetLearning: {
        workflowCount: 1,
        entityCount: 1,
        hypothesisKinds: ['workflow_bypass'],
        experimentStatuses: ['rejected'],
        expectedEndpoints: [{ method: 'GET', path: '/private-random-route' }],
        observedEndpoints: [{ method: 'GET', path: '/private-random-route' }],
      },
    })
    const benchmark = (controlScore: DiscoveryRunScore) => scoreDiscoveryBenchmark([
      ...Array.from({ length: 9 }, () => ({ variant: 'vulnerable' as const, score: score('vulnerable') })),
      ...Array.from({ length: 9 }, () => ({ variant: 'control' as const, score: controlScore })),
    ])

    expect(benchmark(incomplete).learningPass).toBe(false)
    expect(benchmark(incomplete).targetLearning.qualifiedControlRuns).toBe(0)
    expect(benchmark(complete).learningPass).toBe(true)
    expect(benchmark(complete).targetLearning.qualifiedControlRuns).toBe(9)
  })
})

describe('blinded loopback targets', () => {
  it('keeps the experiment-to-hypothesis-to-endpoint link for benchmark scoring', () => {
    const endpoint = {
      id: 'endpoint-1', type: 'Endpoint',
      properties: { method: 'POST', url: 'http://127.0.0.1:41235/random/finish?token=secret' },
    }
    const hypothesis = {
      id: 'hypothesis-1', type: 'Hypothesis',
      properties: { kind: 'workflow_bypass', targetEndpoints: ['endpoint-1'] },
    }
    const experiment = {
      id: 'experiment-1', type: 'Experiment',
      properties: { hypothesisId: 'hypothesis-1', status: 'rejected' },
    }
    const mapped = mapExperiment(experiment, new Map([[hypothesis.id, hypothesis]]), new Map([[endpoint.id, endpoint]]), [endpoint])

    expect(mapped).toMatchObject({
      hypothesisId: 'hypothesis-1',
      hypothesisKind: 'workflow_bypass',
      status: 'rejected',
      targetEndpoints: [{ method: 'POST', path: '/random/finish' }],
    })
  })

  it('builds a pinned NVIDIA config scoped to one generated origin', () => {
    const model = 'nvidia/nemotron-3-super-120b-a12b'
    const target = 'http://127.0.0.1:41235/'
    const raw = load(makeConfig(model, target)) as Record<string, unknown>
    const config = validateConfig({ ...raw, creds: { nvidia: { apiKey: 'fixture-key' } } })
    expect(config.provider).toBe('nvidia')
    expect(config.model).toBe(model)
    expect(config.modelTiers?.fast?.model).toBe(model)
    expect(config.modelTiers?.powerful?.model).toBe(model)
    expect(config.scope).toMatchObject({
      allowedDomains: ['127.0.0.1'], allowedOrigins: ['http://127.0.0.1:41235'],
      allowedProtocols: ['http'], allowPrivateAddresses: true, enforcement: 'hard',
    })
  })

  it('allows only the configured disposable loopback origin', () => {
    const config = {
      allowedDomains: ['127.0.0.1'], allowedOrigins: ['http://127.0.0.1:32100'],
      allowedProtocols: ['http'], allowPrivateAddresses: true, enforcement: 'hard' as const,
    }
    expect(isUrlInScope('http://127.0.0.1:32100/', config, { allowAny: false }).allowed).toBe(true)
    expect(isUrlInScope('http://127.0.0.1:32101/', config, { allowAny: false }).allowed).toBe(false)
    expect(isUrlInScope('http://example.com/', config, { allowAny: false }).allowed).toBe(false)
  })

  it('matches one-time offer behavior except for replay in the vulnerable variant', async () => {
    const fixture = makeFixture('case-1')
    const vulnerable = await startTarget(fixture, 'vulnerable')
    const control = await startTarget(fixture, 'control')
    targets.push(vulnerable, control)
    const post = (base: string) => fetch(new URL(fixture.route, base), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ offer: fixture.voucher }),
    })
    expect((await post(vulnerable.target)).status).toBe(200)
    expect((await post(vulnerable.target)).status).toBe(200)
    expect((await post(control.target)).status).toBe(200)
    expect((await post(control.target)).status).toBe(409)
  })

  it('matches recovery routes but consumes the link only in the control', async () => {
    const fixture = makeFixture('case-2')
    const vulnerable = await startTarget(fixture, 'vulnerable')
    const control = await startTarget(fixture, 'control')
    targets.push(vulnerable, control)
    const issue = (base: string) => fetch(new URL(fixture.route, base), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: fixture.email }),
    }).then(response => response.text())
    const ticketFrom = (body: string) => body.match(/href="([^"]+ticket=[a-f0-9]+)"/)?.[1]
    const vulnerableTicket = ticketFrom(await issue(vulnerable.target))!
    const controlTicket = ticketFrom(await issue(control.target))!
    const reset = (base: string, ticket: string, password: string) => fetch(new URL(ticket, base), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }),
    })
    expect((await reset(vulnerable.target, vulnerableTicket, 'first')).status).toBe(200)
    expect((await reset(vulnerable.target, vulnerableTicket, 'second')).status).toBe(200)
    expect((await reset(control.target, controlTicket, 'first')).status).toBe(200)
    expect((await reset(control.target, controlTicket, 'second')).status).toBe(410)
  })

  it('lets a supplied peer record load with the other actor token only in the vulnerable variant', async () => {
    const fixture = makeFixture('case-3')
    const vulnerable = await startTarget(fixture, 'vulnerable')
    const control = await startTarget(fixture, 'control')
    targets.push(vulnerable, control)
    const login = async (base: string, username: string, password: string) => {
      const response = await fetch(new URL(fixture.route, base), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
      })
      return (await response.json() as { session: string }).session
    }
    const [ownerV, peerV, ownerC] = await Promise.all([
      login(vulnerable.target, fixture.ownerUser, fixture.ownerPassword),
      login(vulnerable.target, fixture.peerUser, fixture.peerPassword),
      login(control.target, fixture.ownerUser, fixture.ownerPassword),
    ])
    expect((await fetch(new URL(`${fixture.route}/record/${fixture.peerDocument}`, vulnerable.target), {
      headers: { authorization: `Bearer ${peerV}` },
    })).status).toBe(200)
    expect((await fetch(new URL(`${fixture.route}/record/${fixture.peerDocument}`, vulnerable.target), {
      headers: { authorization: `Bearer ${ownerV}` },
    })).status).toBe(200)
    expect((await fetch(new URL(`${fixture.route}/record/${fixture.peerDocument}`, control.target), {
      headers: { authorization: `Bearer ${ownerC}` },
    })).status).toBe(403)
  })
})
