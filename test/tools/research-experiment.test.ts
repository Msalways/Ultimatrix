import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mastra/core/tools', () => ({ createTool: (config: any) => config }))

const experiment = {
  id: 'experiment:1',
  type: 'Experiment',
  properties: { status: 'running' },
  updatedAt: 0,
}
const store = {
  getNode: vi.fn(() => experiment),
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
