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

  it('proves a marker URL echoed into response headers (redirect sinks)', () => {
    const marker = 'https://marker-abc123.example.com/'
    const oracle = { type: 'unique-marker' as const, baselineEvidenceId: 'base', mutationEvidenceId: 'mut', marker }
    const base = evidence('base', '', { status: 302, responseHeaders: { location: '/' } })
    const mut = evidence('mut', '', { status: 302, responseHeaders: { location: marker } })
    expect(evaluateExperimentOracle('exp', oracle, [base, mut]).status).toBe('proven')
    // Marker already in the baseline Location is not fresh evidence.
    const baseLeak = evidence('base', '', { status: 302, responseHeaders: { Location: marker } })
    expect(evaluateExperimentOracle('exp', oracle, [baseLeak, mut]).status).toBe('disproven')
    // Header-name case must not matter (fetch lowercases, HAR preserves).
    const mutCap = evidence('mut', '', { status: 302, responseHeaders: { Location: marker } })
    expect(evaluateExperimentOracle('exp', oracle, [base, mutCap]).status).toBe('proven')
  })

  it('proves only successful structured collection growth and leaves parse failures inconclusive', () => {
    const oracle = { type: 'json-array-growth' as const, baselineEvidenceId: 'base', mutationEvidenceId: 'mut', minimumGrowth: 5 }
    const base = evidence('base', '[{}, {}, {}]', { status: 200 })
    const mutation = evidence('mut', '[{}, {}, {}, {}, {}, {}, {}, {}]', { status: 200 })
    expect(evaluateExperimentOracle('exp', oracle, [base, mutation]).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', oracle, [base, evidence('mut', 'SQL error', { status: 500 })])).toMatchObject({ status: 'inconclusive' })
    expect(evaluateExperimentOracle('exp', { ...oracle, minimumGrowth: 6 }, [base, mutation]).status).toBe('disproven')
  })

  it('proves a SQL-specific error only when the named observed input alone changed on the same route and actor', () => {
    const oracle = {
      type: 'database-error-differential' as const,
      baselineEvidenceId: 'base',
      mutationEvidenceId: 'mut',
      inputLocation: 'query' as const,
      parameter: 'q',
    }
    const baseline = evidence('base', '[]', { method: 'GET', url: 'https://app.test/search?q=apple', status: 200 })
    const mutation = evidence('mut', 'SQLITE_ERROR: near quote: syntax error', { method: 'GET', url: 'https://app.test/search?q=%27', status: 500 })
    expect(evaluateExperimentOracle('exp', oracle, [baseline, mutation]).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', oracle, [
      baseline,
      evidence('mut', 'SQLITE_ERROR: near quote: syntax error', { method: 'GET', url: 'https://app.test/other?q=%27', status: 500 }),
    ])).toMatchObject({ status: 'inconclusive' })
    expect(evaluateExperimentOracle('exp', oracle, [
      baseline,
      evidence('mut', 'SQLITE_ERROR: near quote: syntax error', { method: 'GET', url: 'https://app.test/search?q=%27&page=2', status: 500 }),
    ])).toMatchObject({ status: 'inconclusive' })
    expect(evaluateExperimentOracle('exp', oracle, [
      baseline,
      evidence('mut', 'SQLITE_ERROR: near quote: syntax error', {
        method: 'GET', url: 'https://app.test/search?q=%27', status: 500, actorFingerprint: 'different-actor',
      }),
    ])).toMatchObject({ status: 'inconclusive' })
    expect(evaluateExperimentOracle('exp', oracle, [
      evidence('base', 'syntax error in SQL statement', { method: 'GET', url: 'https://app.test/search?q=apple', status: 500 }), mutation,
    ]).status).toBe('disproven')
  })

  it('checks JSON and form input changes without accepting unrelated body mutations', () => {
    const jsonOracle = {
      type: 'database-error-differential' as const,
      baselineEvidenceId: 'base', mutationEvidenceId: 'mut', inputLocation: 'json' as const, parameter: 'query',
    }
    const jsonBaseline = evidence('base', '[]', {
      method: 'POST', url: 'https://app.test/search', requestBody: '{"query":"apple","limit":10}',
    })
    const jsonMutation = evidence('mut', 'syntax error at or near quote', {
      method: 'POST', url: 'https://app.test/search', requestBody: '{"query":"quote","limit":10}',
    })
    expect(evaluateExperimentOracle('exp', jsonOracle, [jsonBaseline, jsonMutation]).status).toBe('proven')

    const formOracle = { ...jsonOracle, inputLocation: 'form' as const, parameter: 'q' }
    const formBaseline = evidence('base', '[]', {
      method: 'POST', url: 'https://app.test/search', requestBody: 'q=apple&limit=10',
    })
    const formMutation = evidence('mut', 'syntax error at or near quote', {
      method: 'POST', url: 'https://app.test/search', requestBody: 'q=quote&limit=10',
    })
    expect(evaluateExperimentOracle('exp', formOracle, [formBaseline, formMutation]).status).toBe('proven')
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

  it('proves business-state changes from the same captured JSON or text read path', () => {
    const jsonOracle = {
      type: 'state-transition' as const,
      beforeEvidenceId: 'before', afterEvidenceId: 'after',
      stateKey: 'account.balance', beforeValue: '17', afterValue: '34',
    }
    const before = evidence('before', '', {
      method: 'GET', url: 'https://app.test/account', status: 200,
      responseBody: '{"account":{"balance":17}}', actorFingerprint: 'actor-a',
    })
    const after = evidence('after', '', {
      method: 'GET', url: 'https://app.test/account', status: 200,
      responseBody: '{"account":{"balance":34}}', actorFingerprint: 'actor-a',
    })
    expect(evaluateExperimentOracle('exp', jsonOracle, [before, after]).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', { ...jsonOracle, stateKey: 'body:balance', beforeValue: '17 credits', afterValue: '34 credits' }, [
      evidence('before', '', { method: 'GET', url: 'https://app.test/account', status: 200, responseBody: '<p>balance: 17 credits</p>', actorFingerprint: 'actor-a' }),
      evidence('after', '', { method: 'GET', url: 'https://app.test/account', status: 200, responseBody: '<p>balance: 34 credits</p>', actorFingerprint: 'actor-a' }),
    ]).status).toBe('proven')
    expect(evaluateExperimentOracle('exp', jsonOracle, [before, evidence('after', '', {
      method: 'GET', url: 'https://app.test/other', status: 200,
      responseBody: '{"account":{"balance":34}}', actorFingerprint: 'actor-a',
    })])).toMatchObject({ status: 'inconclusive' })
  })
})
