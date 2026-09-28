import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mastra/core/tools', () => ({ createTool: (config: any) => config }))

const experiment = {
  id: 'experiment:1',
  type: 'Experiment',
  properties: { status: 'running' },
  updatedAt: 0,
}
const idorHypothesis = {
  id: 'hypothesis:idor-1',
  type: 'Hypothesis',
  properties: { kind: 'idor', status: 'open' },
}
const store = {
  getNode: vi.fn((id: string) => id === idorHypothesis.id ? idorHypothesis : experiment),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => store }))

describe('evaluateResearchExperiment tool', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    experiment.properties = { status: 'running' }
    const { coreEvidenceLedger } = await import('../../src/core/evidence')
    coreEvidenceLedger.clear()
    coreEvidenceLedger.record({ id: 'baseline', type: 'raw_response', data: 'clean', label: 'baseline' })
    coreEvidenceLedger.record({ id: 'mutation', type: 'raw_response', data: 'marker-9', label: 'mutation' })
  })

  it('persists a proven typed outcome on the experiment', async () => {
    const { evaluateResearchExperiment } = await import('../../src/tools/research-tools')
    const result = await evaluateResearchExperiment.execute({
      experimentId: experiment.id,
      oracle: { type: 'unique-marker', baselineEvidenceId: 'baseline', mutationEvidenceId: 'mutation', marker: 'marker-9' },
    } as any, {} as any)
    expect(result).toMatchObject({ ok: true, value: { outcome: { status: 'proven' } } })
    expect(experiment.properties).toMatchObject({ status: 'interesting', outcome: { status: 'proven' } })
    expect(store.save).toHaveBeenCalledOnce()
  })

  it('persists a distinct proven retest with fresh evidence and marker', async () => {
    const { evaluateResearchExperiment } = await import('../../src/tools/research-tools')
    await evaluateResearchExperiment.execute({
      experimentId: experiment.id,
      oracle: { type: 'unique-marker', baselineEvidenceId: 'baseline', mutationEvidenceId: 'mutation', marker: 'marker-9' },
      phase: 'initial',
    } as any, {} as any)
    const { coreEvidenceLedger } = await import('../../src/core/evidence')
    coreEvidenceLedger.record({ id: 'retest-baseline', type: 'raw_response', data: 'clean', label: 'retest baseline' })
    coreEvidenceLedger.record({ id: 'retest-mutation', type: 'raw_response', data: 'marker-10', label: 'retest mutation' })

    const result = await evaluateResearchExperiment.execute({
      experimentId: experiment.id,
      oracle: { type: 'unique-marker', baselineEvidenceId: 'retest-baseline', mutationEvidenceId: 'retest-mutation', marker: 'marker-10' },
      phase: 'retest',
    } as any, {} as any)

    expect(result).toMatchObject({ ok: true, value: { phase: 'retest', outcome: { status: 'proven', proof: { phase: 'retest' } } } })
    expect((experiment.properties as any).retest.outcome.proof.evidenceRefs).toEqual(['retest-baseline', 'retest-mutation'])
  })

  it('keeps a retest inconclusive when it reuses original evidence', async () => {
    const { evaluateResearchExperiment } = await import('../../src/tools/research-tools')
    await evaluateResearchExperiment.execute({
      experimentId: experiment.id,
      oracle: { type: 'unique-marker', baselineEvidenceId: 'baseline', mutationEvidenceId: 'mutation', marker: 'marker-9' },
      phase: 'initial',
    } as any, {} as any)
    const result = await evaluateResearchExperiment.execute({
      experimentId: experiment.id,
      oracle: { type: 'unique-marker', baselineEvidenceId: 'baseline', mutationEvidenceId: 'mutation', marker: 'marker-9' },
      phase: 'retest',
    } as any, {} as any)
    expect(result).toMatchObject({ ok: true, value: { outcome: { status: 'inconclusive' } } })
  })
})

describe('automatic experiment mutations', () => {
  it('changes a structured identifier for IDOR experiments', async () => {
    const { automaticMutation } = await import('../../src/tools/research-tools')
    expect(automaticMutation('idor', { url: 'https://target.test/api/orders/41' })).toEqual({
      url: 'https://target.test/api/orders/42',
    })
  })

  it('adds a structural JSON probe for mass-assignment experiments', async () => {
    const { automaticMutation } = await import('../../src/tools/research-tools')
    const mutation = automaticMutation('mass_assignment', {
      url: 'https://target.test/api/profile',
      body: '{"name":"user"}',
    })
    expect(JSON.parse(mutation.body!)).toMatchObject({ name: 'user', __sentinel_probe: true })
  })

  it('swaps the destination param for a reserved-host marker URL on open_redirect', async () => {
    const { automaticMutation } = await import('../../src/tools/research-tools')
    const mutation = automaticMutation('open_redirect', { url: 'https://target.test/r?url=BASELINEVALUE' }, ['url'])
    expect(mutation.url).toMatch(/^https:\/\/target\.test\/r\?url=https%3A%2F%2Fmarker-[0-9a-f]{12}\.example\.com%2F$/)
  })
})

describe('planned experiment approval boundary', () => {  it('blocks active methods unless the engagement is explicitly in run mode', async () => {
    const { executePlannedExperiment } = await import('../../src/tools/research-tools')
    const { setInteractionMode } = await import('../../src/tools/interaction-tools')
    experiment.properties = {
      status: 'planned',
      baselineRequest: { method: 'POST', url: 'https://target.test/api/profile' },
    }
    setInteractionMode('ask')
    const result = await executePlannedExperiment.execute({ experimentId: experiment.id } as any, {} as any)
    expect(result).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    setInteractionMode(undefined)
  })
})

describe('two-actor gate for cross-user experiments', () => {
  async function withCleanSessions<T>(fn: () => Promise<T>): Promise<T> {
    const { getGlobalSessionManager } = await import('../../src/http/session-manager')
    const sm = getGlobalSessionManager()
    const prior = sm.listSessions()
    const backup = prior.map(name => ({ name, session: sm.exportSession(name)! }))
    for (const name of prior) sm.removeSession(name)
    try {
      return await fn()
    } finally {
      for (const name of sm.listSessions()) sm.removeSession(name)
      for (const { session } of backup) sm.importSession({ ...session })
    }
  }

  function planIdorExperiment() {
    experiment.properties = {
      status: 'planned',
      hypothesisId: idorHypothesis.id,
      baselineRequest: { method: 'GET', url: 'https://target.test/api/orders/41' },
    }
  }

  it('fails closed with ACTORS_REQUIRED when fewer than two sessions exist', async () => {
    await withCleanSessions(async () => {
      const { executePlannedExperiment } = await import('../../src/tools/research-tools')
      planIdorExperiment()
      const result = await executePlannedExperiment.execute({ experimentId: experiment.id } as any, {} as any)
      expect(result).toMatchObject({ ok: false, code: 'ACTORS_REQUIRED' })
      expect(String((result as any).error)).toMatch(/two authenticated actors/i)
      expect(experiment.properties.status).toBe('blocked')
    })
  })

  it('passes the gate for information_disclosure (anonymous comparison is valid)', async () => {
    await withCleanSessions(async () => {
      const { executePlannedExperiment } = await import('../../src/tools/research-tools')
      const disclosureHyp = { id: 'hypothesis:disc-1', type: 'Hypothesis', properties: { kind: 'information_disclosure', status: 'open' } }
      const realGetNode = store.getNode
      ;(store as any).getNode = vi.fn((id: string) => id === disclosureHyp.id ? disclosureHyp : experiment)
      try {
        experiment.properties = {
          status: 'planned',
          hypothesisId: disclosureHyp.id,
          baselineRequest: { method: 'GET', url: 'https://target.test/api/profile' },
        }
        const result = await executePlannedExperiment.execute({ experimentId: experiment.id } as any, {} as any)
        // Past the actor gate: fails later at capture matching, never ACTORS_REQUIRED.
        expect((result as any).code).not.toBe('ACTORS_REQUIRED')
        expect(result).toMatchObject({ ok: false })
      } finally {
        ;(store as any).getNode = realGetNode
      }
    })
  })

  it('passes the gate when two actors exist', async () => {
    await withCleanSessions(async () => {
      const { getGlobalSessionManager } = await import('../../src/http/session-manager')
      const { executePlannedExperiment } = await import('../../src/tools/research-tools')
      const sm = getGlobalSessionManager()
      sm.createSession('actor-a', 'https://target.test')
      sm.createSession('actor-b', 'https://target.test')
      planIdorExperiment()
      const result = await executePlannedExperiment.execute({ experimentId: experiment.id } as any, {} as any)
      expect((result as any).code).not.toBe('ACTORS_REQUIRED')
    })
  })
})
