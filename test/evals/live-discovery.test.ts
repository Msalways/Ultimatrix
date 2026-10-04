import { afterEach, describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { makeConfig, makeFixture, startTarget } from '../../scripts/live-discovery-benchmark'
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
  return scoreDiscoveryRun({
    variant,
    findings: variant === 'vulnerable' ? [proof.finding] : [],
    experiments: variant === 'vulnerable' ? [proof.experiment] : [],
    candidates: [],
    requiresSecondActor: false,
    secondActorAvailable: true,
    untracedRequests: [],
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
        experimentStatuses: ['planned', 'interesting'],
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
      nonPlannedExperiments: 1,
    })
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
    expect(passing.verifiedVulnerableRuns).toBe(7)
    expect(passing.targetLearning).toMatchObject({ runs: 18, averageEndpointRecall: null, averageHypothesisRecall: null })
    const falsePositive = scoreDiscoveryBenchmark([
      ...Array.from({ length: 9 }, () => ({ variant: 'vulnerable' as const, score: vulnerable })),
      ...Array.from({ length: 8 }, () => ({ variant: 'control' as const, score: control })),
      { variant: 'control', score: { ...control, confirmedFindingCount: 1 } },
    ])
    expect(falsePositive.controlPass).toBe(false)
    expect(falsePositive.pass).toBe(false)
  })
})

describe('blinded loopback targets', () => {
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
