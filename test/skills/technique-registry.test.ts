import { describe, it, expect, beforeAll } from 'vitest'
import { TechniqueRegistry, resetTechniqueRegistry } from '../../src/skills/technique-registry'

describe('TechniqueRegistry', () => {
  let registry: TechniqueRegistry

  beforeAll(() => {
    resetTechniqueRegistry()
    registry = new TechniqueRegistry()
  })

  describe('attack paths', () => {
    it('loads attack paths from skills + config', () => {
      const paths = registry.getAttackPaths()
      expect(paths.length).toBeGreaterThan(0)
      expect(paths).toContain('sqli')
      expect(paths).toContain('xss')
      expect(paths).toContain('idor')
    })

    it('matches attack paths from text', () => {
      const matched = registry.matchAttackPaths('test for SQL injection and XSS')
      expect(matched).toContain('sqli')
      expect(matched).toContain('xss')
    })

    it('returns empty for unmatched text', () => {
      const matched = registry.matchAttackPaths('hello world')
      expect(matched).toHaveLength(0)
    })

    it('gets keywords for a specific path', () => {
      const keywords = registry.getKeywordsForPath('sqli')
      expect(keywords.length).toBeGreaterThan(0)
      expect(keywords).toContain('sqli')
    })
  })

  describe('tool inference', () => {
    it('infers tools from task description', () => {
      const tools = registry.inferToolsFromTask('test for SQL injection')
      expect(tools).toContain('checkWaf')
      expect(tools).toContain('measureTiming')
    })

    it('infers XSS tools', () => {
      const tools = registry.inferToolsFromTask('find cross-site scripting vulnerabilities')
      expect(tools).toContain('evaluateRendered')
      expect(tools).toContain('getDialogEvidence')
    })

    it('returns empty for unmatched description', () => {
      const tools = registry.inferToolsFromTask('hello world')
      expect(tools).toHaveLength(0)
    })

    it('gets tools for a specific technique', () => {
      const tools = registry.getToolsForTechnique('sqli')
      expect(tools.length).toBeGreaterThan(0)
    })

    it('gets tools grouped by priority', () => {
      const byPriority = registry.getToolsByPriority()
      expect(byPriority.high.length).toBeGreaterThan(0)
      expect(byPriority.medium.length).toBeGreaterThan(0)
    })
  })

  describe('chain rules', () => {
    it('loads chain rules from config', () => {
      const rules = registry.getChainRules()
      expect(rules.length).toBeGreaterThan(0)
      expect(rules.some(r => r.source === 'xss')).toBe(true)
    })

    it('gets chains from a source technique', () => {
      const chains = registry.getChainsFromSource('xss')
      expect(chains.length).toBeGreaterThan(0)
      expect(chains.some(r => r.target === 'session-hijack')).toBe(true)
    })

    it('gets follow-ups for a technique', () => {
      const followUps = registry.getFollowUps('xss')
      expect(followUps.length).toBeGreaterThan(0)
    })
  })

  describe('workflow classification', () => {
    it('classifies login workflow', () => {
      const result = registry.classifyWorkflow('https://example.com/login')
      expect(result.name).toBe('login')
      expect(result.stateChanges.length).toBeGreaterThan(0)
    })

    it('classifies billing workflow', () => {
      const result = registry.classifyWorkflow('https://example.com/checkout')
      expect(result.name).toBe('billing flow')
    })

    it('returns unknown for unmatched URL', () => {
      const result = registry.classifyWorkflow('https://example.com/random-page')
      expect(result.name).toBe('random-page')
    })
  })

  describe('entity fields', () => {
    it('loads entity fields from config', () => {
      const fields = registry.getEntityFields()
      expect(fields.owner.length).toBeGreaterThan(0)
      expect(fields.role.length).toBeGreaterThan(0)
      expect(fields.sensitive.length).toBeGreaterThan(0)
    })

    it('categorizes owner fields', () => {
      expect(registry.categorizeField('userId')).toBe('owner')
      expect(registry.categorizeField('ownerId')).toBe('owner')
    })

    it('categorizes role fields', () => {
      expect(registry.categorizeField('isAdmin')).toBe('role')
      expect(registry.categorizeField('permissions')).toBe('role')
    })

    it('categorizes sensitive fields', () => {
      expect(registry.categorizeField('password')).toBe('sensitive')
      expect(registry.categorizeField('email')).toBe('sensitive')
    })

    it('returns null for unknown fields', () => {
      expect(registry.categorizeField('randomField')).toBeNull()
    })
  })

  describe('failure classification', () => {
    it('classifies env constraint', () => {
      expect(registry.classifyFailure('waf blocked')).toBe('envConstraint')
      expect(registry.classifyFailure('403 forbidden')).toBe('envConstraint')
    })

    it('classifies path error', () => {
      expect(registry.classifyFailure('not vulnerable')).toBe('pathError')
      expect(registry.classifyFailure('dead end')).toBe('pathError')
    })

    it('classifies param error', () => {
      expect(registry.classifyFailure('invalid payload')).toBe('paramError')
      expect(registry.classifyFailure('syntax error')).toBe('paramError')
    })

    it('classifies info needed', () => {
      expect(registry.classifyFailure('need more information')).toBe('infoNeeded')
      expect(registry.classifyFailure('fingerprint first')).toBe('infoNeeded')
    })

    it('returns unknown for unmatched text', () => {
      expect(registry.classifyFailure('something random happened')).toBe('unknown')
    })
  })

  describe('detection patterns', () => {
    it('loads WAF signatures', () => {
      const sigs = registry.getWafSignatures()
      expect(sigs.length).toBeGreaterThan(0)
      expect(sigs.some(s => s.vendor === 'cloudflare')).toBe(true)
    })

    it('loads tech stack fingerprints', () => {
      const fp = registry.getTechStackFingerprints()
      expect(fp.length).toBeGreaterThan(0)
      expect(fp.some(f => f.name === 'Next.js')).toBe(true)
    })

    it('loads sensitive fields', () => {
      const fields = registry.getSensitiveFields()
      expect(fields.length).toBeGreaterThan(0)
      expect(fields).toContain('password')
    })

    it('loads rate limit patterns', () => {
      const patterns = registry.getRateLimitPatterns()
      expect(patterns.length).toBeGreaterThan(0)
      expect(patterns).toContain('429')
    })
  })

  describe('escalation', () => {
    it('gets escalation hints for level 0', () => {
      const hints = registry.getEscalationHints(0)
      expect(hints.length).toBe(1)
    })

    it('gets escalation hints for level 4', () => {
      const hints = registry.getEscalationHints(4)
      expect(hints.length).toBeGreaterThan(0)
    })
  })

  describe('skill queries', () => {
    it('gets all skills', () => {
      const skills = registry.getSkills()
      expect(skills.size).toBeGreaterThan(0)
    })

    it('searches skills by query', () => {
      const results = registry.searchSkills('sql injection')
      expect(results.length).toBeGreaterThan(0)
    })
  })
})
