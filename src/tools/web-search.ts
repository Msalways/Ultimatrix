/**
 * Web Search tool — wraps the SearchOrchestrator for the brain agent.
 *
 * Open-source engines only (DuckDuckGo + Sploitus). No paid APIs.
 * The brain can search for CVEs, exploit techniques, vendor bypasses,
 * attack patterns, and general security knowledge on-demand.
 *
 * Modes:
 *   - exploit: Sploitus exploit database first, fallback to DuckDuckGo
 *   - research: DuckDuckGo with security-focused query
 *   - answer: DuckDuckGo instant answer
 *   - links: DuckDuckGo general search, fallback to Sploitus
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { SearchOrchestrator, type SearchMode } from '../search/orchestrator'

const orchestrator = new SearchOrchestrator() // No Tavily key — open-source only

export const webSearch = createTool({
  id: 'webSearch',
  description: `Search the web for security information: CVEs, exploit techniques, attack patterns, vendor-specific bypasses, and advisories. Uses open-source engines (DuckDuckGo + Sploitus exploit database). No API key required. Use this when you need to look up a specific vulnerability, find exploit code, research a technology stack, or discover attack vectors for a target.`,
  inputSchema: z.object({
    query: z.string().describe('Search query (e.g. "CVE-2024-1234 exploit", "Apache mod_rewrite bypass", "Spring Boot actuator endpoints")'),
    mode: z.enum(['exploit', 'research', 'answer', 'links']).default('exploit').describe('Search mode: exploit (Sploitus exploit DB first), research (general security research), answer (instant answer), links (general web search)'),
    maxResults: z.number().default(5).describe('Maximum results to return (1-10)'),
  }),
  execute: async ({ query, mode, maxResults }) => {
    const safeMax = Math.min(10, Math.max(1, maxResults ?? 5))
    const response = await orchestrator.search({
      query,
      mode: mode as SearchMode,
      maxResults: safeMax,
    })

    if (response.results.length === 0) {
      return {
        ok: false,
        error: response.error ?? `No results found via ${response.engine}`,
        engine: response.engine,
        fallbacksUsed: response.fallbacksUsed,
        query,
        mode,
      }
    }

    return {
      ok: true,
      engine: response.engine,
      mode: response.mode,
      query: response.query,
      results: response.results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet.length > 500 ? r.snippet.slice(0, 497) + '...' : r.snippet,
        score: r.score,
      })),
      fallbacksUsed: response.fallbacksUsed,
      totalResults: response.results.length,
    }
  },
})
