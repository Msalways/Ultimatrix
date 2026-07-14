import { describe, it, expect } from 'vitest'
import { classifyImpact, escalateImpactForTechnique } from '../../src/council/approval'
import type { MemberOutput } from '../../src/council/types'

describe('Approval — classifyImpact (root-cause fix)', () => {
  it('reads impact from typed proposal field, not text', () => {
    const lowOutput: MemberOutput = {
      text: 'Attempt privilege escalation via sudo', // text says "privilege escalation" = HIGH regex
      intent: 'propose',
      proposal: {
        action: 'Attempt privilege escalation via sudo',
        skillId: 'exploitation',
        complexity: 'high',
        impact: 'low', // LLM declares LOW
        reasoning: 'test',
        evidenceRequired: [],
      },
    }
    expect(classifyImpact(lowOutput)).toBe('low') // Uses typed field, not text regex
  })

  it('returns low when proposal is missing (safe default)', () => {
    const output: MemberOutput = { text: 'do something', intent: 'propose' }
    expect(classifyImpact(output)).toBe('low')
  })

  it('returns critical when LLM declares critical', () => {
    const output: MemberOutput = {
      text: 'Simple recon',
      intent: 'propose',
      proposal: {
        action: 'Simple recon',
        skillId: 'recon',
        complexity: 'low',
        impact: 'critical',
        reasoning: 'test',
        evidenceRequired: [],
      },
    }
    expect(classifyImpact(output)).toBe('critical')
  })

  it('returns high when LLM declares high', () => {
    const output: MemberOutput = {
      text: 'Recon',
      intent: 'propose',
      proposal: {
        action: 'Recon',
        skillId: 'recon',
        complexity: 'low',
        impact: 'high',
        reasoning: 'test',
        evidenceRequired: [],
      },
    }
    expect(classifyImpact(output)).toBe('high')
  })

  it('returns medium when LLM declares medium', () => {
    const output: MemberOutput = {
      text: 'Critical auth bypass',
      intent: 'propose',
      proposal: {
        action: 'Critical auth bypass',
        skillId: 'exploitation',
        complexity: 'critical',
        impact: 'medium',
        reasoning: 'test',
        evidenceRequired: [],
      },
    }
    expect(classifyImpact(output)).toBe('medium') // Uses typed field, not text regex
  })

  it('ignores text keywords when impact field is set', () => {
    // Old regex would have classified this as critical due to "reverse shell"
    const output: MemberOutput = {
      text: 'Test reverse shell capability',
      intent: 'propose',
      proposal: {
        action: 'Test reverse shell capability',
        skillId: 'exploitation',
        complexity: 'critical',
        impact: 'low', // LLM says low — we trust it
        reasoning: 'Just checking if netcat is available',
        evidenceRequired: [],
      },
    }
    expect(classifyImpact(output)).toBe('low') // Structured field wins
  })
})

describe('Approval — escalateImpactForTechnique (C1, fail-closed)', () => {
  it('escalates a destructive technique declared low to its floor (injection → high)', () => {
    expect(escalateImpactForTechnique('low', 'injection')).toBe('high')
  })

  it('escalates critical techniques declared low to critical (authBypass → critical)', () => {
    expect(escalateImpactForTechnique('low', 'authBypass')).toBe('critical')
    expect(escalateImpactForTechnique('medium', 'reverseShell')).toBe('critical')
  })

  it('never downgrades a declared impact below the technique floor', () => {
    expect(escalateImpactForTechnique('critical', 'injection')).toBe('critical')
    expect(escalateImpactForTechnique('high', 'injection')).toBe('high')
  })

  it('trusts declared impact for unknown techniques', () => {
    expect(escalateImpactForTechnique('low', 'recon')).toBe('low')
    expect(escalateImpactForTechnique('medium', 'osint')).toBe('medium')
  })

  it('fail-closed: missing impact + unknown technique → high', () => {
    expect(escalateImpactForTechnique(undefined, 'unknownSkill')).toBe('high')
  })

  it('fail-closed: missing impact + known technique → technique floor', () => {
    expect(escalateImpactForTechnique(undefined, 'injection')).toBe('high')
    expect(escalateImpactForTechnique(undefined, 'authBypass')).toBe('critical')
  })
})
