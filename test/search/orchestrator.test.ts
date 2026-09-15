import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SearchOrchestrator, type SearchMode } from '../../src/search/orchestrator'

describe('SearchOrchestrator', () => {
  let orchestrator: SearchOrchestrator

  beforeEach(() => {
    orchestrator = new SearchOrchestrator()
  })

  describe('getAvailability', () => {
    it('reports duckduckgo as always available', () => {
      const avail = orchestrator.getAvailability()
      expect(avail.duckduckgo).toBe(true)
    })

    it('reports sploitus as available', () => {
      const avail = orchestrator.getAvailability()
      expect(avail.sploitus).toBe(true)
    })

    it('reports tavily as unavailable without API key', () => {
      const avail = orchestrator.getAvailability()
      expect(avail.tavily).toBe(false)
    })
  })

  describe('fallback chains', () => {
    it('exploit mode uses sploitus first', async () => {
      // Mock fetch to simulate empty responses (test chain ordering)
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never

      try {
        const resp = await orchestrator.search({ query: 'SQL injection', mode: 'exploit' })
        expect(resp.fallbacksUsed.some(f => f.includes('sploitus'))).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('research mode skips sploitus', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never

      try {
        const resp = await orchestrator.search({ query: 'CVE analysis', mode: 'research' })
        expect(resp.fallbacksUsed.some(f => f.startsWith('sploitus'))).toBe(false)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('links mode uses duckduckgo first', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never

      try {
        const resp = await orchestrator.search({ query: 'target.com', mode: 'links' })
        expect(resp.fallbacksUsed.some(f => f.startsWith('duckduckgo'))).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('response structure', () => {
    it('returns SearchResponse with all required fields', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never

      try {
        const resp = await orchestrator.search({ query: 'test', mode: 'links' })
        expect(resp).toHaveProperty('engine')
        expect(resp).toHaveProperty('mode', 'links')
        expect(resp).toHaveProperty('query', 'test')
        expect(resp).toHaveProperty('results')
        expect(resp).toHaveProperty('fallbacksUsed')
        expect(Array.isArray(resp.results)).toBe(true)
        expect(Array.isArray(resp.fallbacksUsed)).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('returns error when all engines fail', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never

      try {
        const resp = await orchestrator.search({ query: 'test', mode: 'exploit' })
        expect(resp.engine).toBe('none')
        expect(resp.error).toBeDefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('mode validation', () => {
    it('accepts all valid modes', () => {
      const modes: SearchMode[] = ['links', 'answer', 'research', 'exploit']
      for (const mode of modes) {
        // Should not throw
        orchestrator.search({ query: 'test', mode })
      }
    })
  })
})
