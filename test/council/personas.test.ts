import { describe, it, expect, beforeEach } from 'vitest'
import { personaFor, personaMetadataFor } from '../../src/council/personas'
import { clearPersonaCache } from '../../src/council/persona-loader'
import type { CouncilMemberRole } from '../../src/council/types'

describe('Council personas (file loader)', () => {
  beforeEach(() => {
    clearPersonaCache()
  })

  it('includes structured output contract for LLM roles', () => {
    const roles: CouncilMemberRole[] = ['strategist', 'operator', 'skeptic', 'analyst']
    for (const role of roles) {
      const persona = personaFor(role)
      expect(persona).toContain('intent')
      expect(persona).toContain('propose')
      expect(persona).toContain('critique')
      expect(persona).toContain('complete')
      expect(persona).toContain('escalate')
      expect(persona).toContain('```json')
    }
  })

  it('does NOT include output contract for human role', () => {
    const persona = personaFor('human')
    expect(persona).not.toContain('```json')
    expect(persona).toContain('human operator')
  })

  it('respects persona overrides', () => {
    const custom = personaFor('strategist', 'Custom persona text')
    expect(custom).toBe('Custom persona text')
  })

  it('each persona mentions its role-specific behavior', () => {
    expect(personaFor('strategist')).toContain('Architect')
    expect(personaFor('operator')).toContain('Runner')
    expect(personaFor('skeptic')).toContain('Auditor')
    expect(personaFor('analyst')).toContain('Cartographer')
  })

  it('loads persona metadata from YAML frontmatter', () => {
    const meta = personaMetadataFor('strategist')
    expect(meta.id).toBe('strategist')
    expect(meta.name).toBe('The Architect')
    expect(meta.role).toBe('strategist')
    expect(meta.authority).toBe('attack-direction')
  })

  it('includes charter in all LLM personas', () => {
    const roles: CouncilMemberRole[] = ['strategist', 'operator', 'skeptic', 'analyst']
    for (const role of roles) {
      const persona = personaFor(role)
      expect(persona).toContain('How You Work Together')
      expect(persona).toContain('red team')
    }
  })

  it('includes debate protocol in all LLM personas', () => {
    const roles: CouncilMemberRole[] = ['strategist', 'operator', 'skeptic', 'analyst']
    for (const role of roles) {
      const persona = personaFor(role)
      expect(persona).toContain('Council Debate')
      expect(persona).toContain('Phase 1')
    }
  })

  it('includes backstory and expertise for rich personas', () => {
    // Backstory is in YAML metadata, not the prompt body
    const strategistMeta = personaMetadataFor('strategist')
    expect(strategistMeta.backstory).toContain('offensive security')
    expect(Array.isArray(strategistMeta.expertise)).toBe(true)
    expect(strategistMeta.expertise).toContain('Attack surface mapping')

    const skepticMeta = personaMetadataFor('skeptic')
    expect(skepticMeta.backstory).toContain('Application security auditor')
    expect(skepticMeta.expertise).toContain('Evidence verification')

    // Prompt body contains role-specific mandate text
    const strategist = personaFor('strategist')
    expect(strategist).toContain('Architect')
    expect(strategist).toContain('chains')
  })
})

describe('Council structured output contract', () => {
  it('defines impact levels matching ImpactLevel type', () => {
    const persona = personaFor('strategist')
    expect(persona).toContain('low: passive recon')
    expect(persona).toContain('medium: active probing')
    expect(persona).toContain('high: exploit attempts')
    expect(persona).toContain('critical: auth bypass')
  })

  it('defines complexity levels', () => {
    const persona = personaFor('operator')
    expect(persona).toContain('low: simple HTTP requests')
    expect(persona).toContain('medium: multi-step requests')
    expect(persona).toContain('high: complex chains')
    expect(persona).toContain('critical: full exploitation')
  })
})
