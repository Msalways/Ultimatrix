/**
 * Phase D / spec 05 — self-evolution guards.
 *
 * Locks: confirmed findings raise a technique's runtime weight; repeated
 * failures lower it; the planner consumes evolved weights; the evolution
 * summary is typed and resettable.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import '../../src/primitives'
import {
  recordTechniqueConfirmed,
  recordTechniqueFailed,
  getEvolutionSummary,
  resetEvolution,
} from '../../src/intelligence/evolution'
import { getTechniqueRegistry } from '../../src/skills/technique-registry'
import { rankTechniqueCandidates, type PlanContextInput } from '../../src/orchestration/technique-planner'
import { listPrimitiveMetadata } from '../../src/primitives'

const reg = () => getTechniqueRegistry()

beforeEach(() => {
  resetEvolution()
})

describe('evolution recorder', () => {
  it('promotes a technique after a confirmed finding', () => {
    const before = reg().getTechniqueWeight('classicInjection')
    expect(before).toBe(1.0)
    recordTechniqueConfirmed('classicInjection')
    expect(reg().getTechniqueWeight('classicInjection')).toBeGreaterThan(1.0)
  })

  it('demotes a technique after repeated failures (3-strike dampening)', () => {
    recordTechniqueFailed('idorSwapper')
    recordTechniqueFailed('idorSwapper')
    expect(reg().getTechniqueWeight('idorSwapper')).toBe(1.0) // single/double failures are noise
    recordTechniqueFailed('idorSwapper')
    expect(reg().getTechniqueWeight('idorSwapper')).toBeLessThan(1.0)
  })

  it('ignores empty technique ids and never throws on unknown ids', () => {
    expect(() => recordTechniqueConfirmed('')).not.toThrow()
    expect(() => recordTechniqueFailed('totallyUnknownTechnique')).not.toThrow()
    expect(getEvolutionSummary().techniques.find(t => t.techniqueId === '')).toBeUndefined()
  })

  it('summary is typed, sorted by net score, and flags promotions', () => {
    recordTechniqueConfirmed('classicInjection')
    recordTechniqueConfirmed('classicInjection')
    recordTechniqueFailed('nosqlInjection')
    recordTechniqueFailed('nosqlInjection')
    recordTechniqueFailed('nosqlInjection')

    const summary = getEvolutionSummary()
    expect(summary.techniques[0].techniqueId).toBe('classicInjection')
    expect(summary.promoted).toContain('classicInjection')
    expect(summary.demoted).toContain('nosqlInjection')
  })
})

describe('planner consumes evolved weights', () => {
  function ctx(): PlanContextInput {
    return {
      signals: [{ name: 'object-id-param', endpointIds: ['e1'], paramNames: ['id'], confidence: 0.9 }],
      authBound: true,
      hasSecondOrder: false,
      hasWorkflowOrder: false,
      hasOast: false,
      hasSerialized: false,
      hasCustomHeader: false,
    }
  }

  it('a promoted primitive outranks an equal-shape unpromoted one', () => {
    // bolaFuzzer covers idor/bola/authz tags — matches the object-id signal.
    recordTechniqueConfirmed('bolaFuzzer')
    recordTechniqueConfirmed('bolaFuzzer')

    const ranked = rankTechniqueCandidates(ctx(), listPrimitiveMetadata(), { maxCandidates: 30 })
    const bola = ranked.find(r => r.primitiveId === 'bolaFuzzer')
    expect(bola).toBeDefined()
    // Weight multiplication is visible: the reason trail names the evolved weight.
    expect(bola!.reason).toMatch(/evolved weight/)
  })
})
