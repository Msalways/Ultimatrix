import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadPersonaFile,
  loadCharter,
  loadDebateProtocol,
  loadOutputContract,
  personaMetadata,
  clearPersonaCache,
} from '../../src/council/persona-loader'

describe('Persona Loader', () => {
  beforeEach(() => {
    clearPersonaCache()
  })

  describe('loadPersonaFile', () => {
    it('loads strategist persona with metadata', () => {
      const persona = loadPersonaFile('strategist')
      expect(persona.metadata.id).toBe('strategist')
      expect(persona.metadata.name).toBe('The Architect')
      expect(persona.metadata.role).toBe('strategist')
      expect(persona.metadata.tier).toBe('powerful')
      expect(persona.prompt).toContain('Architect')
      expect(persona.prompt).toContain('chains')
    })

    it('loads operator persona', () => {
      const persona = loadPersonaFile('operator')
      expect(persona.metadata.id).toBe('operator')
      expect(persona.metadata.name).toBe('The Runner')
      expect(persona.prompt).toContain('Runner')
    })

    it('loads skeptic persona', () => {
      const persona = loadPersonaFile('skeptic')
      expect(persona.metadata.id).toBe('skeptic')
      expect(persona.metadata.name).toBe('The Auditor')
      expect(persona.prompt).toContain('Auditor')
    })

    it('loads analyst persona', () => {
      const persona = loadPersonaFile('analyst')
      expect(persona.metadata.id).toBe('analyst')
      expect(persona.metadata.name).toBe('The Cartographer')
      expect(persona.prompt).toContain('Cartographer')
    })

    it('throws for non-existent persona', () => {
      expect(() => loadPersonaFile('nonexistent')).toThrow('Persona file not found')
    })
  })

  describe('loadCharter', () => {
    it('loads charter with team structure', () => {
      const charter = loadCharter()
      expect(charter.metadata.id).toBe('charter')
      expect(charter.prompt).toContain('red team')
      expect(charter.prompt).toContain('How You Work Together')
    })
  })

  describe('loadDebateProtocol', () => {
    it('loads debate protocol with 5 phases', () => {
      const protocol = loadDebateProtocol()
      expect(protocol.metadata.id).toBe('debate-protocol')
      expect(protocol.prompt).toContain('Phase 1')
      expect(protocol.prompt).toContain('Phase 5')
      expect(protocol.prompt).toContain('One proposal per turn')
    })
  })

  describe('loadOutputContract', () => {
    it('loads output contract with JSON schemas', () => {
      const contract = loadOutputContract()
      expect(contract.metadata.id).toBe('output-contract')
      expect(contract.prompt).toContain('```json')
      expect(contract.prompt).toContain('propose')
      expect(contract.prompt).toContain('critique')
      expect(contract.prompt).toContain('complete')
    })
  })

  describe('personaMetadata', () => {
    it('returns metadata for valid role', () => {
      const meta = personaMetadata('strategist')
      expect(meta.id).toBe('strategist')
      expect(meta.authority).toBe('attack-direction')
    })

    it('parses array values from frontmatter', () => {
      const meta = personaMetadata('strategist')
      expect(Array.isArray(meta.expertise)).toBe(true)
      expect(meta.expertise).toContain('Attack surface mapping')
    })

    it('parses string toolRestrictions', () => {
      const meta = personaMetadata('operator')
      expect(meta.toolRestrictions).toBeDefined()
      expect(Array.isArray(meta.toolRestrictions)).toBe(true)
    })

    it('parses wildcard toolRestrictions', () => {
      const meta = personaMetadata('strategist')
      expect(meta.toolRestrictions).toBe('*')
    })
  })

  describe('caching', () => {
    it('caches loaded files', () => {
      const first = loadPersonaFile('strategist')
      const second = loadPersonaFile('strategist')
      expect(first).toBe(second) // Same reference = cached
    })

    it('clearCache forces reload', () => {
      const first = loadPersonaFile('strategist')
      clearPersonaCache()
      const second = loadPersonaFile('strategist')
      expect(first).not.toBe(second) // Different reference = reloaded
      expect(first.prompt).toBe(second.prompt) // But same content
    })
  })
})
