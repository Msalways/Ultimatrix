/**
 * Search Engine — Mode-based search with fallback chains.
 *
 * Agent declares intent (links/answer/research/exploit), system picks
 * engine chain with fallback. Adapted from PentAGI web_search.go.
 *
 * Engines:
 *   - Sploitus: exploit/PoC database
 *   - DuckDuckGo: general web search (no API key needed)
 *   - Tavily: research-oriented search (API key optional)
 */

// ─── Types ──────────────────────────────────────────────────────────

export type SearchMode = 'links' | 'answer' | 'research' | 'exploit'

export interface SearchQuery {
  query: string
  mode: SearchMode
  maxResults?: number
  /** Sploitus-only: filter by exploit type */
  exploitType?: 'exploits' | 'tools'
}

export interface SearchResultItem {
  title: string
  url: string
  snippet: string
  score?: number
}

export interface SearchResponse {
  engine: string
  mode: SearchMode
  query: string
  results: SearchResultItem[]
  fallbacksUsed: string[]
  error?: string
}

export interface SearchEngine {
  name: string
  isAvailable(): boolean
  search(query: SearchQuery): Promise<SearchResultItem[]>
}

// ─── DuckDuckGo Engine (no API key) ────────────────────────────────

class DuckDuckGoEngine implements SearchEngine {
  name = 'duckduckgo'

  isAvailable(): boolean {
    return true // Always available (uses HTML scraping via fetch)
  }

  async search(query: SearchQuery): Promise<SearchResultItem[]> {
    try {
      const params = new URLSearchParams({
        q: query.query,
        format: 'json',
        no_redirect: '1',
        no_html: '1',
        skip_disambig: '1',
      })

      const resp = await fetch(`https://api.duckduckgo.com/?${params}`, {
        signal: AbortSignal.timeout(10_000),
      })

      if (!resp.ok) return []

      const data = await resp.json() as Record<string, unknown>
      const results: SearchResultItem[] = []

      // Abstract (instant answer)
      if (data.AbstractText && typeof data.AbstractText === 'string' && data.AbstractText.length > 0) {
        results.push({
          title: String(data.Heading ?? query.query),
          url: String(data.AbstractURL ?? ''),
          snippet: data.AbstractText,
          score: 1.0,
        })
      }

      // Related topics
      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, query.maxResults ?? 5)) {
          if (typeof topic === 'object' && topic !== null && 'Text' in topic) {
            const t = topic as { Text?: string; FirstURL?: string }
            if (t.Text && t.FirstURL) {
              results.push({
                title: t.Text.slice(0, 100),
                url: t.FirstURL,
                snippet: t.Text,
                score: 0.8,
              })
            }
          }
        }
      }

      return results.slice(0, query.maxResults ?? 5)
    } catch {
      return []
    }
  }
}

// ─── Sploitus Engine (exploit database) ────────────────────────────

class SploitusEngine implements SearchEngine {
  name = 'sploitus'

  isAvailable(): boolean {
    return true // Sploitus has a public API (no key required for basic queries)
  }

  async search(query: SearchQuery): Promise<SearchResultItem[]> {
    try {
      const params = new URLSearchParams({
        query: query.query,
        title: '',
        sort: 'default',
        type: query.exploitType ?? 'exploits',
        version: '',
      })

      const resp = await fetch(`https://sploitus.com/api/search?${params}`, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ultimatrix/8.0',
        },
      })

      if (!resp.ok) return []

      const data = await resp.json() as { exploits?: Array<Record<string, unknown>> }
      const results: SearchResultItem[] = []

      if (Array.isArray(data.exploits)) {
        for (const exploit of data.exploits.slice(0, query.maxResults ?? 5)) {
          results.push({
            title: String(exploit.title ?? exploit.name ?? 'Untitled'),
            url: String(exploit.url ?? exploit.source_url ?? ''),
            snippet: String(exploit.description ?? exploit.source_description ?? ''),
            score: Number(exploit.score ?? 0.5),
          })
        }
      }

      return results.slice(0, query.maxResults ?? 5)
    } catch {
      return []
    }
  }
}

// ─── Tavily Engine (research-oriented) ─────────────────────────────

class TavilyEngine implements SearchEngine {
  name = 'tavily'
  private apiKey?: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async search(query: SearchQuery): Promise<SearchResultItem[]> {
    if (!this.apiKey) return []

    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: query.query,
          max_results: query.maxResults ?? 5,
          search_depth: query.mode === 'research' ? 'advanced' : 'basic',
          include_answer: query.mode === 'answer',
        }),
        signal: AbortSignal.timeout(15_000),
      })

      if (!resp.ok) return []

      const data = await resp.json() as {
        results?: Array<{ title: string; url: string; content: string; score?: number }>
        answer?: string
      }
      const results: SearchResultItem[] = []

      if (data.answer) {
        results.push({
          title: `Answer: ${query.query}`,
          url: '',
          snippet: data.answer,
          score: 1.0,
        })
      }

      if (Array.isArray(data.results)) {
        for (const r of data.results.slice(0, query.maxResults ?? 5)) {
          results.push({
            title: r.title,
            url: r.url,
            snippet: r.content,
            score: r.score ?? 0.5,
          })
        }
      }

      return results.slice(0, query.maxResults ?? 5)
    } catch {
      return []
    }
  }
}

// ─── Orchestrator ──────────────────────────────────────────────────

/** Fallback chains per search mode. Adapted from PentAGI web_search.go. */
const FALLBACK_CHAINS: Record<SearchMode, string[]> = {
  exploit:  ['sploitus', 'tavily', 'duckduckgo'],
  research: ['tavily', 'duckduckgo'],
  answer:   ['tavily', 'duckduckgo'],
  links:    ['duckduckgo', 'sploitus'],
}

export class SearchOrchestrator {
  private engines: Map<string, SearchEngine> = new Map()

  constructor(config?: { tavilyApiKey?: string }) {
    this.engines.set('duckduckgo', new DuckDuckGoEngine())
    this.engines.set('sploitus', new SploitusEngine())
    this.engines.set('tavily', new TavilyEngine(config?.tavilyApiKey))
  }

  /** Search with mode-based fallback chain. Returns first successful engine. */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const chain = FALLBACK_CHAINS[query.mode] ?? FALLBACK_CHAINS.links
    const fallbacksUsed: string[] = []

    for (const engineName of chain) {
      const engine = this.engines.get(engineName)
      if (!engine || !engine.isAvailable()) {
        fallbacksUsed.push(`${engineName}:unavailable`)
        continue
      }

      try {
        const results = await engine.search(query)
        if (results.length > 0) {
          return {
            engine: engineName,
            mode: query.mode,
            query: query.query,
            results,
            fallbacksUsed,
          }
        }
        fallbacksUsed.push(`${engineName}:empty`)
      } catch (err) {
        fallbacksUsed.push(`${engineName}:error:${String(err)}`)
      }
    }

    return {
      engine: 'none',
      mode: query.mode,
      query: query.query,
      results: [],
      fallbacksUsed,
      error: `All engines failed for mode=${query.mode}`,
    }
  }

  /** Check which engines are available. */
  getAvailability(): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    for (const [name, engine] of this.engines) {
      result[name] = engine.isAvailable()
    }
    return result
  }
}
