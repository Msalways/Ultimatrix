/**
 * CapturedRequestStore — session-scoped registry of full captured requests.
 *
 * The replay seam (P3.1): every outbound httpRequest and every ingested HAR
 * entry lands here with a stable id, so the brain can list captured traffic
 * and re-fire any request with structural mutations (Strix's
 * list_requests/repeat_request capability) without a proxy sidecar.
 *
 * Single source of truth for "what did we actually send" — replay rebuilds
 * from these typed records, never from LLM memory of past requests.
 */

import type { HarEntry } from './har-parser'

export interface CapturedRequest {
  id: string
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  status?: number
  responseHeaders?: Record<string, string>
  responseBody?: string
  source: 'tool' | 'har'
  capturedAt: number
}

export interface CapturedRequestRef {
  id: string
  method: string
  url: string
  status?: number
  source: CapturedRequest['source']
}

export interface CapturedRequestFilter {
  method?: string
  urlContains?: string
  host?: string
  limit?: number
}

function harHeadersToRecord(headers: { name: string; value: string }[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of headers ?? []) out[h.name] = h.value
  return out
}

export class CapturedRequestStore {
  private entries = new Map<string, CapturedRequest>()
  private seq = 0

  record(input: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
    status?: number
    responseHeaders?: Record<string, string>
    responseBody?: string
  }): CapturedRequest {
    this.seq += 1
    const entry: CapturedRequest = {
      id: `cap-${this.seq}`,
      method: input.method,
      url: input.url,
      headers: { ...(input.headers ?? {}) },
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.responseHeaders ? { responseHeaders: input.responseHeaders } : {}),
      ...(input.responseBody !== undefined ? { responseBody: input.responseBody } : {}),
      source: 'tool',
      capturedAt: Date.now(),
    }
    this.entries.set(entry.id, entry)
    return entry
  }

  /** Ingest HAR entries (spider/learn capture). Returns count ingested. */
  ingestHarEntries(entries: readonly HarEntry[]): number {
    let n = 0
    for (const e of entries) {
      if (!e?.request?.url || !e?.request?.method) continue
      this.seq += 1
      const entry: CapturedRequest = {
        id: `cap-${this.seq}`,
        method: e.request.method,
        url: e.request.url,
        headers: harHeadersToRecord(e.request.headers),
        body: e.request.postData?.text,
        status: e.response?.status,
        responseHeaders: harHeadersToRecord(e.response?.headers),
        responseBody: e.response?.content?.text,
        source: 'har',
        capturedAt: Date.now(),
      }
      this.entries.set(entry.id, entry)
      n += 1
    }
    return n
  }

  list(filter?: CapturedRequestFilter): CapturedRequestRef[] {
    const refs: CapturedRequestRef[] = []
    for (const e of this.entries.values()) {
      if (filter?.method && e.method.toUpperCase() !== filter.method.toUpperCase()) continue
      if (filter?.host) {
        try {
          if (new URL(e.url).host !== filter.host) continue
        } catch {
          continue
        }
      }
      if (filter?.urlContains && !e.url.includes(filter.urlContains)) continue
      refs.push({ id: e.id, method: e.method, url: e.url, status: e.status, source: e.source })
      if (filter?.limit && refs.length >= filter.limit) break
    }
    return refs
  }

  get(id: string): CapturedRequest | null {
    return this.entries.get(id) ?? null
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
    this.seq = 0
  }
}

let singleton: CapturedRequestStore | null = null

export function getCapturedRequestStore(): CapturedRequestStore {
  if (!singleton) singleton = new CapturedRequestStore()
  return singleton
}
