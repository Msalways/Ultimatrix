import { describe, it, expect, vi } from 'vitest'
import type { FindingNode } from '../../src/graph/schema'

function makeFinding(technique: string, id = 'f1'): FindingNode {
  return {
    id,
    type: 'Finding' as any,
    label: `Finding: ${technique}`,
    properties: {
      severity: 'medium',
      endpoint: '/test',
      evidence: [],
      confidence: 0.8,
      technique,
    } as any,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as FindingNode
}

describe('techniqueMatches (typed matcher)', () => {
  it('matches a slug technique exactly', async () => {
    const { techniqueMatches } = await import('../../src/intelligence/chaining')
    expect(techniqueMatches('idor', 'idor')).toBe(true)
    expect(techniqueMatches('idor', 'IDOR')).toBe(true)
  })

  it('aliases a primitive id to its canonical slug (no substring scan)', async () => {
    const { techniqueMatches } = await import('../../src/intelligence/chaining')
    // Production findings are tagged with the primitive id, not the slug.
    expect(techniqueMatches('idor', 'idorSwapper')).toBe(true)
    expect(techniqueMatches('ssrf', 'ssrfOast')).toBe(true)
    expect(techniqueMatches('sqli', 'classicInjection')).toBe(true)
  })

  it('does not match by accidental substring of a different technique', async () => {
    const { techniqueMatches } = await import('../../src/intelligence/chaining')
    // 'authorization' tokenizes to {authorization, auth, ...} — must NOT match 'idor'.
    expect(techniqueMatches('idor', 'authorization')).toBe(false)
  })

  it('splits hyphenated target tokens', async () => {
    const { techniqueMatches } = await import('../../src/intelligence/chaining')
    expect(techniqueMatches('data-exfiltration', 'data-exfiltration')).toBe(true)
    expect(techniqueMatches('session-hijack', 'session-hijack')).toBe(true)
  })
})

describe('proposeChainStep', () => {
  it('maps an idor finding to the bolaFuzzer deepen primitive', async () => {
    const { proposeChainStep } = await import('../../src/intelligence/chain-planner')
    const step = proposeChainStep(makeFinding('idor'))
    expect(step).not.toBeNull()
    expect(step!.kind).toBe('primitive')
    expect(step!.primitiveId).toBe('bolaFuzzer')
    expect(step!.targetTechnique).toBe('idor')
  })

  it('maps an ssrf finding to the ssrfMetadata primitive step', async () => {
    const { proposeChainStep } = await import('../../src/intelligence/chain-planner')
    const step = proposeChainStep(makeFinding('ssrf'))
    expect(step!.kind).toBe('primitive')
    expect(step!.primitiveId).toBe('ssrfMetadata')
    expect(step!.targetTechnique).toBe('ssrf')
  })

  it('maps an xss finding to the atoChain primitive (session-hijack target)', async () => {
    const { proposeChainStep } = await import('../../src/intelligence/chain-planner')
    const step = proposeChainStep(makeFinding('xss'))
    expect(step).not.toBeNull()
    expect(step!.kind).toBe('primitive')
    expect(step!.primitiveId).toBe('atoChain')
    expect(step!.targetTechnique).toBe('session-hijack')
  })

  it('returns null for an unknown technique', async () => {
    const { proposeChainStep } = await import('../../src/intelligence/chain-planner')
    expect(proposeChainStep(makeFinding('unknown-tech'))).toBeNull()
  })
})

describe('runActiveChaining', () => {
  it('executes primitive steps via the injected runner and records them', async () => {
    const { runActiveChaining } = await import('../../src/intelligence/chain-planner')
    const runner = vi.fn().mockResolvedValue({ ok: true, result: { confirmed: true } })
    // idor deepens to bolaFuzzer; a technique with no chain rule produces no step.
    const findings = [makeFinding('idor'), makeFinding('unknown-tech')]
    const res = await runActiveChaining(findings, { runPrimitive: runner, maxSteps: 5 })
    // Only idor yields a chain step (unknown-tech has no rule).
    expect(res.steps).toHaveLength(1)
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith('bolaFuzzer', expect.objectContaining({ endpointUrl: '/test' }))
    expect(res.executed).toHaveLength(1)
    expect(res.executed[0].step.primitiveId).toBe('bolaFuzzer')
  })

  it('does not execute followup-only steps (no mapped primitive)', async () => {
    const { runActiveChaining, proposeChainStep } = await import('../../src/intelligence/chain-planner')
    // Sanity: findings that produce a step always carry a rule; followups (if any
    // rule target lacks a primitive) are proposed but never executed.
    const runner = vi.fn().mockResolvedValue({ ok: true })
    const res = await runActiveChaining([makeFinding('unknown-tech')], { runPrimitive: runner })
    expect(res.steps).toHaveLength(0)
    expect(runner).not.toHaveBeenCalled()
    expect(proposeChainStep(makeFinding('unknown-tech'))).toBeNull()
  })

  it('respects the maxSteps budget', async () => {
    const { runActiveChaining } = await import('../../src/intelligence/chain-planner')
    const runner = vi.fn().mockResolvedValue({ ok: true })
    const findings = [makeFinding('idor'), makeFinding('ssrf'), makeFinding('sqli')]
    const res = await runActiveChaining(findings, { runPrimitive: runner, maxSteps: 2 })
    expect(runner).toHaveBeenCalledTimes(2)
    expect(res.executed).toHaveLength(2)
  })
})
