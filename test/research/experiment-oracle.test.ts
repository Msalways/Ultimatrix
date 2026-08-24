import { describe, expect, it } from 'vitest'
import { evaluateExperimentOracle } from '../../src/research/experiment-oracle'
import type { EvidenceItem } from '../../src/intelligence/evidence-ledger'

const evidence = (id: string, data: string, observed: EvidenceItem['observed'] = {}, session?: string): EvidenceItem => ({
  id,
  type: 'raw_response',
  data,
  label: id,
  timestamp: 1,
  observed,
  ...(session ? { session } : {}),
})

describe('evaluateExperimentOracle', () => {
  it('proves a unique marker only when absent from baseline and present after mutation', () => {
    const oracle = { type: 'unique-marker' as const, baselineEvidenceId: 'base', mutationEvidenceId: 'mut', marker: 'unique-42' }
    expect(evaluateExperimentOracle('exp', oracle, [evidence('base', 'clean'), evidence('mut', 'unique-42')]).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', oracle, [evidence('base', 'unique-42'), evidence('mut', 'unique-42')]).status).toBe('disproven')
  })

  it('returns inconclusive when referenced evidence is missing', () => {
    const outcome = evaluateExperimentOracle('exp', {
      type: 'oast-callback', evidenceId: 'callback', correlationToken: 'token-1',
    }, [])
    expect(outcome).toMatchObject({ status: 'inconclusive', evidenceRefs: [] })
  })

  it('requires distinct actors and a victim-owned marker for cross-identity proof', () => {
    const outcome = evaluateExperimentOracle('exp', {
      type: 'cross-identity', victimEvidenceId: 'victim', attackerEvidenceId: 'attacker',
      victimActorRef: 'actor-a', attackerActorRef: 'actor-b', marker: 'victim-record-7',
    }, [evidence('victim', 'victim-record-7', {}, 'actor-a'), evidence('attacker', 'victim-record-7', {}, 'actor-b')])
    expect(outcome.status).toBe('proven')
  })

  it('uses repeated median timing samples', () => {
    const oracle = {
      type: 'timing-differential' as const,
      baselineEvidenceIds: ['b1', 'b2', 'b3'], mutationEvidenceIds: ['m1', 'm2', 'm3'],
      minSamples: 3, minDeltaMs: 400,
    }
    const items = [100, 110, 120].map((ms, i) => evidence(`b${i + 1}`, '', { responseTimeMs: ms }))
      .concat([600, 610, 620].map((ms, i) => evidence(`m${i + 1}`, '', { responseTimeMs: ms })))
    expect(evaluateExperimentOracle('exp', oracle, items).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', { ...oracle, minSamples: 4 }, items).status).toBe('inconclusive')
  })

  it('evaluates state, callback, and browser effects from typed observed fields', () => {
    const items = [
      evidence('before', '', { state: { role: 'user' } }),
      evidence('after', '', { state: { role: 'admin' } }),
      evidence('callback', '', { correlationToken: 'oast-9' }),
      evidence('browser', '', { browserEffects: { toast: 'saved' } }),
    ]
    expect(evaluateExperimentOracle('exp', { type: 'state-transition', beforeEvidenceId: 'before', afterEvidenceId: 'after', stateKey: 'role', beforeValue: 'user', afterValue: 'admin' }, items).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', { type: 'oast-callback', evidenceId: 'callback', correlationToken: 'oast-9' }, items).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', { type: 'browser-effect', evidenceId: 'browser', effectKey: 'toast', expectedValue: 'saved' }, items).status).toBe('proven')
  })
})
