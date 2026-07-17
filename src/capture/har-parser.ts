import { z } from 'zod'

// HAR 1.2 Types (generic, no hardcoding)
export const HarRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  httpVersion: z.string().optional(),
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    path: z.string().optional(),
    domain: z.string().optional(),
    expires: z.string().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
  })).default([]),
  headers: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })).default([]),
  queryString: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })).default([]),
  postData: z.object({
    mimeType: z.string().optional(),
    text: z.string().optional(),
    params: z.array(z.object({
      name: z.string(),
      value: z.string().optional(),
    })).default([]),
  }).optional(),
  headersSize: z.number().optional(),
  bodySize: z.number().optional(),
})

export const HarResponseSchema = z.object({
  status: z.number(),
  statusText: z.string().optional(),
  httpVersion: z.string().optional(),
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    path: z.string().optional(),
    domain: z.string().optional(),
    expires: z.string().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
  })).default([]),
  headers: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })).default([]),
  content: z.object({
    size: z.number().optional(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    encoding: z.string().optional(),
  }).default({}),
  redirectURL: z.string().optional(),
  headersSize: z.number().optional(),
  bodySize: z.number().optional(),
})

export const HarEntrySchema = z.object({
  startedDateTime: z.string(),
  time: z.number(),
  request: HarRequestSchema,
  response: HarResponseSchema,
  cache: z.object({}).passthrough().optional(),
  timings: z.object({
    send: z.number().optional(),
    wait: z.number().optional(),
    receive: z.number().optional(),
    blocked: z.number().optional(),
    dns: z.number().optional(),
    connect: z.number().optional(),
    ssl: z.number().optional(),
  }).optional(),
  serverIPAddress: z.string().optional(),
  connection: z.string().optional(),
  pageref: z.string().optional(),
})

export const HarArchiveSchema = z.object({
  log: z.object({
    version: z.string(),
    creator: z.object({
      name: z.string(),
      version: z.string(),
    }).passthrough(),
    browser: z.object({
      name: z.string().optional(),
      version: z.string().optional(),
    }).passthrough().optional(),
    entries: z.array(HarEntrySchema).default([]),
    comment: z.string().optional(),
  }),
})

export type HarRequest = z.infer<typeof HarRequestSchema>
export type HarResponse = z.infer<typeof HarResponseSchema>
export type HarEntry = z.infer<typeof HarEntrySchema>
export type HarArchive = z.infer<typeof HarArchiveSchema>

// Derived types
export interface Endpoint {
  method: string
  url: string
  host: string
  path: string
  queryParams: Record<string, string>
  requestCount: number
  avgResponseTime: number
}

export interface EndpointWithHeaders {
  method: string
  url: string
  host: string
  path: string
  headers: Record<string, string>
  cookies: Record<string, string>
  params: Array<{ name: string; type: string; in: string; required?: boolean }>
  authType: string | null
}

export interface Secret {
  type: string
  location: 'header' | 'body' | 'url' | 'cookie'
  entryIndex: number
  name: string
  value: string
  description: string
}

export interface DataFlow {
  source: {
    entryIndex: number
    location: string
    name: string
  }
  sink: {
    entryIndex: number
    location: string
    name: string
  }
  value: string
  type: 'token' | 'cookie' | 'header' | 'param'
}

// Parser functions
export function parseHar(raw: string): HarArchive {
  const parsed = JSON.parse(raw)
  const result = HarArchiveSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid HAR format: ${result.error.issues.map(i => i.message).join(', ')}`)
  }
  return result.data
}

export function parseHarFromObject(obj: unknown): HarArchive {
  const result = HarArchiveSchema.safeParse(obj)
  if (!result.success) {
    throw new Error(`Invalid HAR format: ${result.error.issues.map(i => i.message).join(', ')}`)
  }
  return result.data
}

export function getEntries(archive: HarArchive): HarEntry[] {
  return archive.log.entries
}

export function getEndpoints(entries: HarEntry[]): Endpoint[] {
  const endpointMap = new Map<string, {
    method: string
    url: string
    host: string
    path: string
    queryParams: Record<string, string>
    requestCount: number
    totalTime: number
  }>()

  for (const entry of entries) {
    const url = new URL(entry.request.url)
    const key = `${entry.request.method}:${url.origin}${url.pathname}`

    const existing = endpointMap.get(key)
    const queryParams: Record<string, string> = {}
    for (const param of entry.request.queryString) {
      queryParams[param.name] = param.value
    }

    if (existing) {
      existing.requestCount++
      existing.totalTime += entry.time
    } else {
      endpointMap.set(key, {
        method: entry.request.method,
        url: `${url.origin}${url.pathname}`,
        host: url.host,
        path: url.pathname,
        queryParams,
        requestCount: 1,
        totalTime: entry.time,
      })
    }
  }

  return Array.from(endpointMap.values()).map(ep => ({
    ...ep,
    avgResponseTime: ep.totalTime / ep.requestCount,
  }))
}

export function getEndpointsWithHeaders(entries: HarEntry[]): EndpointWithHeaders[] {
  const endpointMap = new Map<string, EndpointWithHeaders>()

  for (const entry of entries) {
    let urlObj: URL
    try {
      urlObj = new URL(entry.request.url)
    } catch {
      continue
    }
    const key = `${entry.request.method}:${urlObj.origin}${urlObj.pathname}`

    const existing = endpointMap.get(key)
    if (existing) continue

    const headers: Record<string, string> = {}
    for (const h of entry.request.headers) {
      headers[h.name] = h.value
    }

    const cookies: Record<string, string> = {}
    for (const c of entry.request.cookies) {
      cookies[c.name] = c.value
    }

    const params: EndpointWithHeaders['params'] = []
    for (const qs of entry.request.queryString) {
      params.push({ name: qs.name, type: 'query', in: 'query' })
    }
    if (entry.request.postData?.params) {
      for (const p of entry.request.postData.params) {
        params.push({ name: p.name, type: 'body', in: 'body' })
      }
    }

    let authType: string | null = null
    const authHeader = headers['authorization'] || headers['Authorization']
    if (authHeader) {
      if (authHeader.toLowerCase().startsWith('bearer ')) authType = 'bearer'
      else if (authHeader.toLowerCase().startsWith('basic ')) authType = 'basic'
      else authType = 'api-key'
    } else if (Object.keys(cookies).length > 0) {
      authType = 'cookie'
    }

    endpointMap.set(key, {
      method: entry.request.method,
      url: `${urlObj.origin}${urlObj.pathname}`,
      host: urlObj.host,
      path: urlObj.pathname,
      headers,
      cookies,
      params,
      authType,
    })
  }

  return Array.from(endpointMap.values())
}

export function getSecrets(entries: HarEntry[]): Secret[] {
  const secrets: Secret[] = []
  const secretPatterns = [
    { type: 'api_key', patterns: [/api[_-]?key/i, /apikey/i, /access[_-]?key/i] },
    { type: 'token', patterns: [/token/i, /bearer/i, /authorization/i] },
    { type: 'password', patterns: [/password/i, /passwd/i, /pwd/i, /secret/i] },
    { type: 'session', patterns: [/session/i, /sid/i, /jsessionid/i] },
    { type: 'csrf', patterns: [/csrf/i, /xsrf/i, /_token/i] },
    { type: 'jwt', patterns: [/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/] },
  ]

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    // Check headers
    for (const header of entry.request.headers) {
      for (const { type, patterns } of secretPatterns) {
        if (patterns.some(p => p.test(header.name) || p.test(header.value))) {
          secrets.push({
            type,
            location: 'header',
            entryIndex: i,
            name: header.name,
            value: header.value.substring(0, 50) + (header.value.length > 50 ? '...' : ''),
            description: `Potential ${type} found in request header`,
          })
        }
      }
    }

    // Check response headers
    for (const header of entry.response.headers) {
      for (const { type, patterns } of secretPatterns) {
        if (patterns.some(p => p.test(header.name) || p.test(header.value))) {
          secrets.push({
            type,
            location: 'header',
            entryIndex: i,
            name: header.name,
            value: header.value.substring(0, 50) + (header.value.length > 50 ? '...' : ''),
            description: `Potential ${type} found in response header`,
          })
        }
      }
    }

    // Check cookies
    for (const cookie of entry.response.cookies) {
      for (const { type, patterns } of secretPatterns) {
        if (patterns.some(p => p.test(cookie.name))) {
          secrets.push({
            type,
            location: 'cookie',
            entryIndex: i,
            name: cookie.name,
            value: cookie.value.substring(0, 50) + (cookie.value.length > 50 ? '...' : ''),
            description: `Potential ${type} found in cookie`,
          })
        }
      }
    }

    // Check response body
    if (entry.response.content.text) {
      for (const { type, patterns } of secretPatterns) {
        const matches = entry.response.content.text.match(patterns[0])
        if (matches) {
          secrets.push({
            type,
            location: 'body',
            entryIndex: i,
            name: type,
            value: matches[0].substring(0, 50),
            description: `Potential ${type} found in response body`,
          })
        }
      }
    }
  }

  return secrets
}

export function getDataFlows(entries: HarEntry[]): DataFlow[] {
  const flows: DataFlow[] = []
  const valuesSeen = new Map<string, { entryIndex: number; location: string; name: string }>()

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    // Track response cookie values
    for (const cookie of entry.response.cookies) {
      if (cookie.value.length > 5) {
        valuesSeen.set(`cookie:${cookie.name}:${cookie.value}`, {
          entryIndex: i,
          location: 'cookie',
          name: cookie.name,
        })
      }
    }

    // Track response header values (like Authorization, Set-Cookie)
    for (const header of entry.response.headers) {
      if (header.value.length > 10) {
        valuesSeen.set(`header:${header.name}:${header.value}`, {
          entryIndex: i,
          location: 'header',
          name: header.name,
        })
      }
    }

    // Check if request uses values seen in responses
    for (const header of entry.request.headers) {
      for (const [key, source] of valuesSeen) {
        if (key.includes(header.value) && source.entryIndex < i) {
          flows.push({
            source: { entryIndex: source.entryIndex, location: source.location, name: source.name },
            sink: { entryIndex: i, location: 'header', name: header.name },
            value: header.value.substring(0, 30),
            type: header.name.toLowerCase() === 'cookie' ? 'cookie' : 'header',
          })
        }
      }
    }

    // Check if request cookies use values seen in responses
    for (const cookie of entry.request.cookies) {
      for (const [key, source] of valuesSeen) {
        if (key.includes(cookie.value) && source.entryIndex < i) {
          flows.push({
            source: { entryIndex: source.entryIndex, location: source.location, name: source.name },
            sink: { entryIndex: i, location: 'cookie', name: cookie.name },
            value: cookie.value.substring(0, 30),
            type: 'cookie',
          })
        }
      }
    }
  }

  return flows
}

// Export as HAR file
export function exportHar(archive: HarArchive): string {
  return JSON.stringify(archive, null, 2)
}

// Create empty HAR archive
export function createEmptyHar(): HarArchive {
  return {
    log: {
      version: '1.2',
      creator: { name: 'ultimatrix', version: '7.0.0' },
      entries: [],
    },
  }
}

// Add entry to archive
export function addEntry(archive: HarArchive, entry: HarEntry): HarArchive {
  return {
    log: {
      ...archive.log,
      entries: [...archive.log.entries, entry],
    },
  }
}

// Filter entries
export function filterEntries(entries: HarEntry[], predicate: (entry: HarEntry) => boolean): HarEntry[] {
  return entries.filter(predicate)
}

// Get unique hosts
export function getUniqueHosts(entries: HarEntry[]): string[] {
  const hosts = new Set<string>()
  for (const entry of entries) {
    try {
      const url = new URL(entry.request.url)
      hosts.add(url.host)
    } catch {
      // Skip invalid URLs
    }
  }
  return Array.from(hosts)
}

// Get unique paths
export function getUniquePaths(entries: HarEntry[]): string[] {
  const paths = new Set<string>()
  for (const entry of entries) {
    try {
      const url = new URL(entry.request.url)
      paths.add(url.pathname)
    } catch {
      // Skip invalid URLs
    }
  }
  return Array.from(paths)
}

// Get request methods
export function getRequestMethods(entries: HarEntry[]): Record<string, number> {
  const methods: Record<string, number> = {}
  for (const entry of entries) {
    methods[entry.request.method] = (methods[entry.request.method] || 0) + 1
  }
  return methods
}

// ─── CDP Network event → HAR entry builder ───────────────────────────────
// This is the SINGLE owner of HAR assembly from CDP `Network.*` events.
// Modern CDP splits headers/cookies across two events (`requestWillBeSent` +
// `requestWillBeSentExtraInfo`, `responseReceived` + `responseReceivedExtraInfo`),
// so the builder accumulates by `requestId` and merges the ExtraInfo payloads
// rather than dropping them. No other module assembles HAR from CDP events.

export interface CdpNetworkRequestWillBeSentParams {
  requestId: string
  request: {
    url: string
    method: string
    headers?: Record<string, string>
    postData?: string
    mixedContentType?: string
    initialPriority?: string
  }
  timestamp: number
  wallTime?: number
}

export interface CdpNetworkRequestWillBeSentExtraInfoParams {
  requestId: string
  headers?: Record<string, string>
  cookies?: Array<{ name: string; value: string; path?: string; domain?: string }>
}

export interface CdpNetworkResponseReceivedParams {
  requestId: string
  response: {
    url: string
    status: number
    statusText?: string
    headers?: Record<string, string>
    mimeType?: string
    connectionId?: number
    remoteIPAddress?: string
    protocol?: string
  }
  timestamp: number
}

export interface CdpNetworkResponseReceivedExtraInfoParams {
  requestId: string
  headers?: Record<string, string>
  cookies?: Array<{ name: string; value: string; path?: string; domain?: string }>
}

export interface CdpNetworkLoadingFinishedParams {
  requestId: string
  timestamp: number
  encodedDataLength?: number
}

export interface CdpNetworkLoadingFailedParams {
  requestId: string
  errorText: string
  timestamp: number
}

interface PendingEntry {
  request?: HarRequest
  response?: HarResponse
  startedDateTime: string
  startTime: number
  endTime?: number
  bodySize?: number
}

export interface HarEntryBuilder {
  /** Merge a `Network.requestWillBeSent` event. */
  onRequestWillBeSent(params: CdpNetworkRequestWillBeSentParams): void
  /** Merge a `Network.requestWillBeSentExtraInfo` event (headers + cookies). */
  onRequestWillBeSentExtraInfo(params: CdpNetworkRequestWillBeSentExtraInfoParams): void
  /** Merge a `Network.responseReceived` event. */
  onResponseReceived(params: CdpNetworkResponseReceivedParams): void
  /** Merge a `Network.responseReceivedExtraInfo` event (headers + cookies). */
  onResponseReceivedExtraInfo(params: CdpNetworkResponseReceivedExtraInfoParams): void
  /** Mark `Network.loadingFinished` (with optional body size). */
  onLoadingFinished(params: CdpNetworkLoadingFinishedParams): void
  /** Mark `Network.loadingFailed`. */
  onLoadingFailed(params: CdpNetworkLoadingFailedParams): void
  /** Attach a fetched body (from `Network.getResponseBody`/`getRequestPostData`). */
  setRequestBody(requestId: string, body: string): void
  setResponseBody(requestId: string, body: string, encoding?: string): void
  /** Returns completed entries (those that reached loadingFinished/failed). */
  takeCompleted(): HarEntry[]
  /** All entries seen so far (debug / flush). */
  entries(): HarEntry[]
}

function toHeaders(record?: Record<string, string>): Array<{ name: string; value: string }> {
  if (!record) return []
  return Object.entries(record).map(([name, value]) => ({ name, value }))
}

function mergeCookies(
  existing: Array<{ name: string; value: string; path?: string; domain?: string }>,
  incoming?: Array<{ name: string; value: string; path?: string; domain?: string }>,
): Array<{ name: string; value: string; path?: string; domain?: string }> {
  if (!incoming || incoming.length === 0) return existing
  const byName = new Map(existing.map((c) => [c.name, c]))
  for (const c of incoming) byName.set(c.name, c)
  return Array.from(byName.values())
}

export function createHarEntryBuilder(): HarEntryBuilder {
  const pending = new Map<string, PendingEntry>()
  const completed: HarEntry[] = []
  // Spanning lookup so body/post-data setters can reach an entry that has
  // already been finalized (moved out of `pending`) — otherwise they would
  // create orphan entries and the body would never reach the HAR entry.
  const byId = new Map<string, PendingEntry>()

  const ensure = (requestId: string): PendingEntry => {
    let e = byId.get(requestId)
    if (!e) {
      e = { startedDateTime: new Date().toISOString(), startTime: Date.now() }
      pending.set(requestId, e)
      byId.set(requestId, e)
    }
    return e
  }

  const finalize = (entry: PendingEntry, requestId: string) => {
    const req = entry.request ?? {
      method: 'GET',
      url: '',
      headers: [],
      cookies: [],
      queryString: [],
      headersSize: -1,
      bodySize: -1,
    }
    const resp = entry.response ?? {
      status: 0,
      statusText: '',
      headers: [],
      cookies: [],
      content: {},
      headersSize: -1,
      bodySize: -1,
    }
    const time = entry.endTime ? Math.max(0, entry.endTime - entry.startTime) : 0
    const har: HarEntry = {
      startedDateTime: entry.startedDateTime,
      time,
      request: req,
      response: resp,
      cache: {},
      timings: {},
    }
    if (entry.bodySize !== undefined) {
      har.response.content = { ...har.response.content, size: entry.bodySize }
      har.response.bodySize = entry.bodySize
    }
    completed.push(har)
    pending.delete(requestId)
  }

  return {
    onRequestWillBeSent(params) {
      const e = ensure(params.requestId)
      const url = new URL(params.request.url)
      const queryString = Array.from(url.searchParams.entries()).map(([name, value]) => ({ name, value }))
      e.request = {
        method: params.request.method,
        url: params.request.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: toHeaders(params.request.headers),
        queryString,
        postData: params.request.postData
          ? { mimeType: 'application/x-www-form-urlencoded', text: params.request.postData }
          : undefined,
        headersSize: -1,
        bodySize: params.request.postData ? params.request.postData.length : -1,
      }
    },
    onRequestWillBeSentExtraInfo(params) {
      const e = ensure(params.requestId)
      if (!e.request) {
        // ExtraInfo may arrive before requestWillBeSent in rare races; seed a shell.
        e.request = { method: 'GET', url: '', headers: [], cookies: [], queryString: [], headersSize: -1, bodySize: -1 }
      }
      e.request.headers = e.request.headers.concat(toHeaders(params.headers))
      e.request.cookies = mergeCookies(e.request.cookies, params.cookies)
    },
    onResponseReceived(params) {
      const e = ensure(params.requestId)
      e.response = {
        status: params.response.status,
        statusText: params.response.statusText ?? '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: toHeaders(params.response.headers),
        content: { mimeType: params.response.mimeType ?? 'text/plain', size: -1 },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      }
      if (params.response.remoteIPAddress) e['serverIPAddress'] = params.response.remoteIPAddress
      if (params.response.connectionId !== undefined) e['connection'] = String(params.response.connectionId)
    },
    onResponseReceivedExtraInfo(params) {
      const e = ensure(params.requestId)
      if (!e.response) {
        e.response = { status: 0, statusText: '', headers: [], cookies: [], content: {}, headersSize: -1, bodySize: -1 }
      }
      e.response.headers = e.response.headers.concat(toHeaders(params.headers))
      e.response.cookies = mergeCookies(e.response.cookies, params.cookies)
    },
    onLoadingFinished(params) {
      const e = ensure(params.requestId)
      e.endTime = params.timestamp ? Date.now() : e.endTime
      if (params.encodedDataLength !== undefined) e.bodySize = params.encodedDataLength
      if (e.request && e.response) finalize(e, params.requestId)
    },
    onLoadingFailed(params) {
      const e = ensure(params.requestId)
      e.endTime = params.timestamp ? Date.now() : e.endTime
      if (e.request && e.response) finalize(e, params.requestId)
    },
    setRequestBody(requestId, body) {
      const e = ensure(requestId)
      if (!e.request) return
      e.request.postData = e.request.postData
        ? { ...e.request.postData, text: body }
        : { mimeType: 'application/octet-stream', text: body }
      e.request.bodySize = body.length
    },
    setResponseBody(requestId, body, encoding) {
      const e = ensure(requestId)
      if (!e.response) return
      e.response.content = { ...e.response.content, text: body, encoding }
      e.response.bodySize = body.length
    },
    takeCompleted() {
      const out = completed.splice(0, completed.length)
      return out
    },
    entries() {
      const out = Array.from(pending.values())
        .filter((e) => e.request && e.response)
        .map((e) => ({
          startedDateTime: e.startedDateTime,
          time: e.endTime ? Math.max(0, e.endTime - e.startTime) : 0,
          request: e.request!,
          response: e.response!,
          cache: {},
          timings: {},
        })) as HarEntry[]
      return out.concat(completed)
    },
  }
}
