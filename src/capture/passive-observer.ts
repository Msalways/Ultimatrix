import type { Page } from 'playwright'
import { getGlobalGraphStore } from '../graph/store'
import { log } from '../utils/logger'
import { getEngagementServices } from '../runtime/engagement-context'

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
  private cleanup = new Map<Page, Array<() => void>>()

  attach(page: Page): void {
    if (this.pages.has(page)) return
    this.pages.set(page, true)

    const cleaners: Array<() => void> = []
    // Stagehand v3 intentionally exposes only the `console` event on its
    // Playwright-shaped Page wrapper. Its internal NetworkManager is the
    // provider-neutral passive seam, however, and is already fed by the CDP
    // sessions used for navigation. Prefer it before trying Playwright
    // request/response events so observation is not silently lost on Stagehand.
    const stagehandNetwork = (page as any)?.networkManager
    let stagehandNetworkAttached = false
    if (stagehandNetwork && typeof stagehandNetwork.addObserver === 'function') {
      try {
        const dispose = stagehandNetwork.addObserver({
          onRequestStarted: (info: any) => {
            const url = String(info?.url ?? '')
            if (!url) return
            const key = `GET:${url}:${Date.now()}`
            this.requests.set(key, {
              url,
              method: 'GET',
              headers: {},
              timestamp: Date.now(),
            })
          },
          onRequestFinished: () => {},
          onRequestFailed: () => {},
        })
        if (typeof dispose === 'function') cleaners.push(dispose)
        stagehandNetworkAttached = true
        log.dim(`[passive-observer] attached Stagehand NetworkManager observer`)
      } catch (error) {
        log.dim(`[passive-observer] Stagehand network observer unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const onRequest = (request: any) => {
      const url = request.url()
      const key = `${request.method()}:${url}:${Date.now()}`
      const headers: Record<string, string> = {}
      const reqHeaders = request.headers() as Record<string, string>
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
    }

    const onResponse = async (response: any) => {
      const url = response.url()
      const key = `${response.status()}:${url}:${Date.now()}`
      const headers: Record<string, string> = {}
      const resHeaders = response.headers() as Record<string, string>
      for (const [k, v] of Object.entries(resHeaders)) {
        headers[k] = v
      }
      this.responses.set(key, {
        url,
        status: response.status(),
        headers,
        timestamp: Date.now(),
      })
    }

    // Stagehand pages reject Playwright request/response events. Do not probe
    // those events when its NetworkManager observer is active; probing creates
    // noisy false failures and obscures real capture errors.
    if (!stagehandNetworkAttached) {
      if (this.tryAttach(page, 'request', onRequest)) cleaners.push(() => this.tryDetach(page, 'request', onRequest))
      if (this.tryAttach(page, 'response', onResponse)) cleaners.push(() => this.tryDetach(page, 'response', onResponse))
    }
    this.cleanup.set(page, cleaners)

    log.dim(`Passive observer attached to page`)
  }

  detach(page: Page): void {
    for (const fn of this.cleanup.get(page) ?? []) fn()
    this.cleanup.delete(page)
    this.pages.delete(page)
  }

  private tryAttach(page: Page, event: string, handler: (...args: any[]) => void): boolean {
    if (typeof (page as any).on !== 'function') return false
    try {
      ;(page as any).on(event, handler)
      return true
    } catch (error) {
      log.dim(`[passive-observer] ${event} events unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private tryDetach(page: Page, event: string, handler: (...args: any[]) => void): void {
    try {
      const off = (page as any).off ?? (page as any).removeListener
      if (typeof off === 'function') off.call(page, event, handler)
    } catch {}
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

    // Wrap in transaction for persistent stores
    if ('beginTransaction' in store && typeof store.beginTransaction === 'function') {
      // LibSQLGraphStore - use transactions
      store.beginTransaction().then(async () => {
        try {
          for (const [_key, ep] of observedEndpoints) {
            if ('mergeEndpoint' in store && typeof store.mergeEndpoint === 'function') {
              store.mergeEndpoint({
                url: ep.url,
                method: ep.method,
                headers: Object.fromEntries(Object.entries(ep.headers)),
                source: 'passive-observer',
                tags: ['auto-discovered'],
              } as any)
            }
          }
          await (store as any).commitTransaction()
        } catch (error) {
          await (store as any).rollbackTransaction()
          throw error
        }
      })
    } else {
      // GraphStore - no transaction support, but still merge
      for (const [_key, ep] of observedEndpoints) {
        store.mergeEndpoint({
          url: ep.url,
          method: ep.method,
          headers: Object.fromEntries(Object.entries(ep.headers)),
          source: 'passive-observer',
          tags: ['auto-discovered'],
        } as any)
      }
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
  const owned = getEngagementServices()?.passiveObserver
  if (owned) return owned
  if (!_globalObserver) {
    _globalObserver = new PassiveObserver()
  }
  return _globalObserver
}
