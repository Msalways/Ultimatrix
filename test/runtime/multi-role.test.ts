import { describe, it, expect } from 'vitest'
import { getToolsForRole, getRoleDescription, filterToolsForRole, buildRolePrompt, type AgentRole } from '../../src/runtime/multi-role'

describe('MultiRole', () => {
  describe('getToolsForRole', () => {
    it('returns tools for recon role', () => {
      const tools = getToolsForRole('recon')
      expect(tools).toContain('httpRequest')
      expect(tools).toContain('dnsLookup')
      expect(tools).toContain('getGraphSchema')
    })

    it('returns tools for injection role', () => {
      const tools = getToolsForRole('injection')
      expect(tools).toContain('runPrimitive')
      expect(tools).toContain('writeFinding')
    })

    it('returns tools for auth role', () => {
      const tools = getToolsForRole('auth')
      expect(tools).toContain('extractBrowserAuth')
      expect(tools).toContain('detectAuthFlows')
    })

    it('returns tools for reporting role', () => {
      const tools = getToolsForRole('reporting')
      expect(tools).toContain('queryGraph')
      expect(tools).toContain('saveSession')
    })

    it('returns tools for analysis role', () => {
      const tools = getToolsForRole('analysis')
      expect(tools).toContain('queryRelations')
      expect(tools).toContain('runPrimitive')
    })
  })

  describe('filterToolsForRole', () => {
    it('filters tools to role allowed set', () => {
      const all = ['httpRequest', 'queryGraph', 'runPrimitive', 'writeFinding', 'dnsLookup', 'unknownTool']
      const filtered = filterToolsForRole(all, 'recon')
      expect(filtered).toContain('httpRequest')
      expect(filtered).toContain('queryGraph')
      expect(filtered).toContain('dnsLookup')
      expect(filtered).not.toContain('runPrimitive')
      expect(filtered).not.toContain('unknownTool')
    })
  })

  describe('getRoleDescription', () => {
    it('returns config for every role', () => {
      const roles: AgentRole[] = ['recon', 'injection', 'auth', 'reporting', 'analysis']
      for (const role of roles) {
        const config = getRoleDescription(role)
        expect(config.description).toBeTruthy()
        expect(config.toolRefs.length).toBeGreaterThan(0)
        expect(config.focus.length).toBeGreaterThan(0)
      }
    })
  })

  describe('buildRolePrompt', () => {
    it('builds a prompt prefix', () => {
      const prompt = buildRolePrompt('recon')
      expect(prompt).toContain('RECON')
      expect(prompt).toContain('Focus Areas')
      expect(prompt).toContain('Constraints')
    })
  })
})
