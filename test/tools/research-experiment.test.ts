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

  it('changes only the observed query field for a bounded SQLi probe', async () => {
    const { automaticMutation } = await import('../../src/tools/research-tools')
    expect(automaticMutation('sql_injection', { url: 'https://target.test/search?q=apple&lang=en' }, ['q'])).toEqual({
      url: "https://target.test/search?q=%27+OR+1%3D1+OR+%27x%27%3D%27x&lang=en",
    })
  })

  it('uses an unchanged request for workflow replay and refuses unrelated auth stripping', async () => {
    const { automaticMutation } = await import('../../src/tools/research-tools')
    expect(automaticMutation('workflow_bypass', { url: 'https://target.test/api/redeem', body: 'offer=one' })).toEqual({})
    expect(automaticMutation('state_confusion', { url: 'https://target.test/api/redeem', body: 'offer=one' })).toBeUndefined()
  })

  it('strips captured custom actor credentials for an anonymous disclosure check', async () => {
    const { automaticMutation } = await import('../../src/tools/research-tools')
    expect(automaticMutation('information_disclosure', {
      url: 'https://target.test/api/profile',
      headers: { Authorization: 'Bearer private', 'X-Session-ID': 'private', 'X-CSRF-Token': 'private', 'X-Trace': 'keep' },
    })).toEqual({ removeHeaderNames: ['Authorization', 'X-Session-ID', 'X-CSRF-Token'] })
  })
})

describe('stateful replay comparison', () => {
  it('treats duplicate success as a candidate and a rejected replay as expected behavior', async () => {
    const { compareStatefulReplayResponses } = await import('../../src/research/differential')
    const vulnerable = compareStatefulReplayResponses(
      { status: 200, body: '17 credits added' },
      { status: 200, body: '34 credits added' },
    )
    const protectedReplay = compareStatefulReplayResponses(
      { status: 200, body: '17 credits added' },
      { status: 409, body: 'offer already used' },
    )
    expect(vulnerable).toMatchObject({ interesting: true })
    expect(vulnerable.reason).toMatch(/verify the resulting business state/i)
    expect(protectedReplay).toMatchObject({ interesting: false })
    expect(protectedReplay.reason).toMatch(/expected one-time behavior/i)
  })
})

describe('workflow replay execution', () => {
  it('replays the captured state-changing request unchanged and recognizes secure rejection', async () => {
    const { executePlannedExperiment } = await import('../../src/tools/research-tools')
    const { getCapturedRequestStore } = await import('../../src/capture/captured-request-store')
    const { replayCapturedRequest } = await import('../../src/tools/replay-tools')
    const { setInteractionMode } = await import('../../src/tools/interaction-tools')
    const workflowHypothesis = {
      id: 'hypothesis:workflow-1',
      type: 'Hypothesis',
      properties: { kind: 'workflow_bypass', status: 'open' },
    }
    const realGetNode = store.getNode
    const captured = getCapturedRequestStore()
    captured.clear()
    captured.record({ method: 'POST', url: 'https://target.test/api/redeem', status: 200, source: 'browser', body: 'email=member%40example.test' })
    const finalAction = captured.record({ method: 'POST', url: 'https://target.test/api/redeem?ticket=ticket-1', status: 200, source: 'browser', body: 'password=updated' })
    ;(store as any).getNode = vi.fn((id: string) => id === workflowHypothesis.id ? workflowHypothesis : experiment)
    experiment.properties = {
      status: 'planned',
      hypothesisId: workflowHypothesis.id,
      baselineRequest: { method: 'POST', url: 'https://target.test/api/redeem', body: 'offer=one' },
    }
    setInteractionMode('run')
    const replaySpy = vi.spyOn(replayCapturedRequest, 'execute')
      .mockResolvedValueOnce({ ok: true, value: { replayedStatus: 200, response: { body: '17 credits added' } } } as any)
      .mockResolvedValueOnce({ ok: true, value: { replayedStatus: 409, response: { body: 'offer already used' } } } as any)

    try {
      const result = await executePlannedExperiment.execute({ experimentId: experiment.id } as any, {} as any)
      expect(replaySpy).toHaveBeenCalledTimes(2)
      expect(replaySpy.mock.calls[0][0]).toMatchObject({ entryId: finalAction.id })
      expect(replaySpy.mock.calls[1][0]).not.toHaveProperty('removeHeaderNames')
      expect((result as any).value.differential).toMatchObject({ interesting: false })
      expect(experiment.properties.status).toBe('rejected')
    } finally {
      replaySpy.mockRestore()
      setInteractionMode(undefined)
      captured.clear()
      ;(store as any).getNode = realGetNode
    }
  })
})

describe('unsupported race experiment semantics', () => {
  it('blocks race hypotheses before sending sequential requests', async () => {
    const { executePlannedExperiment } = await import('../../src/tools/research-tools')
    const raceHypothesis = {
      id: 'hypothesis:race-1',
      type: 'Hypothesis',
      properties: { kind: 'race_condition', status: 'open' },
    }
    const realGetNode = store.getNode
    ;(store as any).getNode = vi.fn((id: string) => id === raceHypothesis.id ? raceHypothesis : experiment)
    experiment.properties = {
      status: 'planned',
      hypothesisId: raceHypothesis.id,
      baselineRequest: { method: 'GET', url: 'https://target.test/api/claim' },
    }

    try {
      const result = await executePlannedExperiment.execute({ experimentId: experiment.id } as any, {} as any)
      expect(result).toMatchObject({ ok: false, code: 'CONCURRENCY_REQUIRED' })
      expect(experiment.properties.status).toBe('blocked')
    } finally {
      ;(store as any).getNode = realGetNode
    }
  })
})

describe('action-limit experiment handoff', () => {
  it('routes planned action limits to the tracked primitive lifecycle without marking them as structural blockers', async () => {
    const { executePlannedExperiment } = await import('../../src/tools/research-tools')
    const { setInteractionMode } = await import('../../src/tools/interaction-tools')
    const actionLimitHypothesis = {
      id: 'hypothesis:limit-1', type: 'Hypothesis',
      properties: {
        kind: 'action_limit', status: 'planned',
        businessRule: {
          kind: 'action_limit', allowedCount: 1, actionRequestId: 'cap-action', actionMethod: 'POST',
          actionUrl: 'https://target.test/api/redeem', ruleCaptureId: 'cap-rule',
          ruleUrl: 'https://target.test/terms', ruleText: 'This offer may only be used once.',
        },
      },
    }
    const realGetNode = store.getNode
    ;(store as any).getNode = vi.fn((id: string) => id === actionLimitHypothesis.id ? actionLimitHypothesis : experiment)
    experiment.properties = {
      status: 'planned', hypothesisId: actionLimitHypothesis.id,
      baselineRequest: { method: 'POST', url: 'https://target.test/api/redeem' },
    }
    setInteractionMode('run')
    try {
      const result = await executePlannedExperiment.execute({ experimentId: experiment.id } as any, {} as any)
      expect(result).toMatchObject({ ok: false, code: 'SPECIALIZED_PRIMITIVE_REQUIRED', experimentId: experiment.id })
      expect(String((result as any).next)).toContain('businessLogicAbuse')
      expect(experiment.properties.status).toBe('planned')
    } finally {
      setInteractionMode(undefined)
      ;(store as any).getNode = realGetNode
    }
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

describe('planned experiment cancellation', () => {
  it('forwards the solver abort signal to baseline and mutation replays', async () => {
    const { executePlannedExperiment } = await import('../../src/tools/research-tools')
    const { getCapturedRequestStore } = await import('../../src/capture/captured-request-store')
    const { replayCapturedRequest } = await import('../../src/tools/replay-tools')
    const disclosureHypothesis = {
      id: 'hypothesis:disclosure-1',
      type: 'Hypothesis',
      properties: { kind: 'information_disclosure', status: 'open' },
    }
    const realGetNode = store.getNode
    const captured = getCapturedRequestStore()
    captured.clear()
    captured.record({
      method: 'GET', url: 'https://target.test/api/profile', status: 200, source: 'browser',
      headers: { 'X-Session-ID': 'private-actor', 'X-CSRF-Token': 'private-csrf', 'X-Trace': 'keep' },
    })
    ;(store as any).getNode = vi.fn((id: string) => id === disclosureHypothesis.id ? disclosureHypothesis : experiment)
    experiment.properties = {
      status: 'planned',
      hypothesisId: disclosureHypothesis.id,
      baselineRequest: { method: 'GET', url: 'https://target.test/api/profile' },
    }
    const replaySpy = vi.spyOn(replayCapturedRequest, 'execute')
      .mockResolvedValueOnce({ ok: true, value: { replayedStatus: 200, response: { body: 'profile' } } } as any)
      .mockResolvedValueOnce({ ok: true, value: { replayedStatus: 200, response: { body: 'profile' } } } as any)
    const controller = new AbortController()

    try {
      await executePlannedExperiment.execute(
        { experimentId: experiment.id } as any,
        { abortSignal: controller.signal } as any,
      )

      expect(replaySpy).toHaveBeenCalledTimes(2)
      expect(replaySpy.mock.calls[0][1]).toMatchObject({ abortSignal: controller.signal })
      expect(replaySpy.mock.calls[1][1]).toMatchObject({ abortSignal: controller.signal })
      expect(replaySpy.mock.calls[1][0].removeHeaderNames).toEqual(expect.arrayContaining(['X-Session-ID', 'X-CSRF-Token']))
      expect(replaySpy.mock.calls[1][0].removeHeaderNames).not.toContain('X-Trace')
    } finally {
      replaySpy.mockRestore()
      captured.clear()
      ;(store as any).getNode = realGetNode
    }
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
