import { describe, it, expect } from 'vitest'
import { listPrimitives, getPrimitive } from '../../src/primitives'

// The flagship primitives that MUST be registered (single source of truth).
const EXPECTED_IDS = new Set([
  'invariantProbe',
  'workflowBypass',
  'concurrencyHarness',
  'authzMatrix',
  'configTrust',
  'idorSwapper',
  'bolaFuzzer',
  'ssrfOast',
  'classicInjection',
  'headerInjection',
  'aiTrust',
  'authBypass',
  'atoChain',
  'ssrfMetadata',
  'rceClass',
  'graphqlBola',
  'aiAgentAttack',
  'nosqlInjection',
  'ssrfMultiCloud',
  'sstiBlind',
  'boplaOracle',
  'artifactLifetime',
  'internalStateDisclosure',
  'tenantIsolation',
  'deserialization',
  'secondOrderSqli',
  'ldapXpathInjection',
  'smuggling',
  'businessLogicAbuse',
])

describe('primitive registry drift guard', () => {
  it('every registered primitive is retrievable via getPrimitive (no drift)', () => {
    const registered = listPrimitives()
    const ids = registered.map((p) => p.id)
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length)
    // Exactly the expected set.
    expect(new Set(ids)).toEqual(EXPECTED_IDS)
    // Each id resolves to a primitive object.
    for (const id of ids) {
      expect(getPrimitive(id)).toBeDefined()
    }
  })

  it('getPrimitive returns the same object registered in the list', () => {
    for (const p of listPrimitives()) {
      expect(getPrimitive(p.id)).toBe(p)
    }
  })
})
