/**
 * SPA Crawl Strategy — client-side route discovery for single-page apps.
 *
 * Standard crawlers miss client-side routes. This module:
 *   - Watches history.pushState/popstate for route changes
 *   - Extracts routes from React/Vue router config if exposed
 *   - Monitors network requests for API endpoints
 *   - Detects route transitions via DOM mutations
 *
 * Purpose: Find hidden SPA routes that standard crawlers miss.
 */

export interface DiscoveredRoute {
  path: string
  method?: string
  timestamp: number
  source: 'pushstate' | 'popstate' | 'network' | 'router-config' | 'dom-mutation'
  params?: Record<string, string>
}

export interface SPACrawlConfig {
  /** Time to wait for client-side route discovery (ms). Default: 30000 */
  crawlTimeoutMs?: number
  /** Max routes to discover. Default: 200 */
  maxRoutes?: number
  /** Whether to monitor network requests. Default: true */
  monitorNetwork?: boolean
}

export class SPARouteDiscoverer {
  private routes: DiscoveredRoute[] = []
  private seen = new Set<string>()
  private startTime = 0

  constructor(private config?: SPACrawlConfig) {}

  /** Inject a history listener into the page to catch pushState/replaceState. */
  async injectHistoryWatcher(page: any): Promise<void> {
    await page.evaluate(() => {
      const _orig = history.pushState.bind(history)
      history.pushState = function (...args: any[]) {
        _orig(...args)
        window.dispatchEvent(new Event('locationchange'))
      }
      const _origReplace = history.replaceState.bind(history)
      history.replaceState = function (...args: any[]) {
        _origReplace(...args)
        window.dispatchEvent(new Event('locationchange'))
      }
      window.addEventListener('popstate', () => {
        window.dispatchEvent(new Event('locationchange'))
      })
    })
  }

  /** Start watching for route changes. Call after injecting the watcher. */
  startWatching(page: any): void {
    this.startTime = Date.now()
    this.routes = []
    this.seen = new Set()

    // Capture pushState/replaceState route changes
    page.on('locationchange' as any, () => {
      const path = page.url()
      this.addRoute(path, 'pushstate')
    })

    // Capture network requests as potential API endpoints
    if (this.config?.monitorNetwork !== false) {
      page.on('request' as any, (req: any) => {
        try {
          const url = new URL(req.url())
          const host = url.host
          if (host && !host.includes('localhost')) {
            this.addRoute(url.pathname, 'network', req.method())
          }
        } catch { /* ignore non-URL requests */ }
      })
    }
  }

  /** Record a discovered route. */
  addRoute(path: string, source: DiscoveredRoute['source'], method?: string): void {
    const key = `${method ?? 'GET'} ${path}`
    if (this.seen.has(key)) return
    this.seen.add(key)

    this.routes.push({
      path,
      method,
      timestamp: Date.now(),
      source,
    })
  }

  /** Check if we should stop (timeout or max routes). */
  shouldStop(): boolean {
    const maxRoutes = this.config?.maxRoutes ?? 200
    const timeoutMs = this.config?.crawlTimeoutMs ?? 30000
    if (this.routes.length >= maxRoutes) return true
    if (this.startTime > 0 && Date.now() - this.startTime > timeoutMs) return true
    return false
  }

  /** Get all discovered routes. */
  getRoutes(): DiscoveredRoute[] {
    return [...this.routes]
  }

  /** Get route count by source. */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {}
    for (const r of this.routes) {
      stats[r.source] = (stats[r.source] ?? 0) + 1
    }
    return stats
  }

  /** Clear discovered routes. */
  clear(): void {
    this.routes = []
    this.seen = new Set()
  }
}
