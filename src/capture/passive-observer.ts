import type { Page } from 'playwright'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import { log } from '../utils/logger'

interface ObservedRequest {
  url: string
  method: string
  headers: Record<string, string>
  postData?: string
  timestamp: number
}

interface ObservedResponse {
  url: string
  status: number
  headers: Record<string, string>
  body?: string
  timestamp: number
}

export class PassiveObserver {
  private pages = new Map<Page, boolean>()
  private requests = new Map<string, ObservedRequest>()
  private responses = new Map<string, ObservedResponse>()

  attach(page: Page): void {
    if (this.pages.has(page)) return
    this.pages.set(page, true)

    page.on('request', (request) => {
      const url = request.url()
      const key = `${request.method()}:${url}:${Date.now()}`
      const headers: Record<string, string> = {}
      const reqHeaders = request.headers()
      for (const [k, v] of Object.entries(reqHeaders)) {
        headers[k] = v
      }
      this.requests.set(key, {
        url,
        method: request.method(),
        headers,
        postData: request.postData() || undefined,
        timestamp: Date.now(),
      })
    })

    page.on('response', async (response) => {
      const url = response.url()
      const key = `${response.status()}:${url}:${Date.now()}`
      const headers: Record<string, string> = {}
      const resHeaders = response.headers()
      for (const [k, v] of Object.entries(resHeaders)) {
        headers[k] = v
      }
      this.responses.set(key, {
        url,
        status: response.status(),
        headers,
        timestamp: Date.now(),
      })
    })

    log.dim(`Passive observer attached to page`)
  }

  detach(page: Page): void {
    this.pages.delete(page)
  }

  persistToGraph(targetUrl: string): void {
    const store = getGlobalGraphStore()
    const origin = new URL(targetUrl).origin

    const observedEndpoints = new Map<string, { url: string; method: string; headers: Record<string, string> }>()

    for (const [, req] of this.requests) {
      if (!req.url.startsWith(origin)) continue
      const key = `${req.method}:${new URL(req.url).pathname}`
      if (!observedEndpoints.has(key)) {
        observedEndpoints.set(key, { url: req.url, method: req.method, headers: req.headers })
      }
    }

    for (const [key, ep] of observedEndpoints) {
      store.mergeEndpoint({
        url: ep.url,
        method: ep.method,
        headers: Object.entries(ep.headers).map(([name, value]) => ({ name, value })),
        source: 'passive-observer',
        tags: ['auto-discovered'],
      })
    }

    const endpointCount = observedEndpoints.size
    if (endpointCount > 0) {
      log.info(`Passive observer: persisted ${endpointCount} endpoints to graph`)
    }

    this.requests.clear()
    this.responses.clear()
  }

  getStats(): { requests: number; responses: number; pages: number } {
    return {
      requests: this.requests.size,
      responses: this.responses.size,
      pages: this.pages.size,
    }
  }
}

let _globalObserver: PassiveObserver | null = null

export function getGlobalObserver(): PassiveObserver {
  if (!_globalObserver) {
    _globalObserver = new PassiveObserver()
  }
  return _globalObserver
}
