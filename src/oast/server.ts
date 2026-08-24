import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { getGlobalOastStore, OastCallback, type OastStore } from './store'
import { recordStructuredEvidence } from '../tools/control-tools'
import type { OastConfig } from '../config'
import { getEngagementServices, runWithEngagementServices, type EngagementServices } from '../runtime/engagement-context'

let server: ReturnType<typeof createServer> | null = null
let serverPort = 0
let serverReady: Promise<number> | null = null
const oastHost = 'localhost'

interface OastBinding {
  key: string
  store: OastStore
  config: OastConfig | null
  services?: EngagementServices
}

const bindings = new Map<string, OastBinding>()
const storeKeys = new WeakMap<OastStore, string>()
let legacyStore: OastStore | null = null

let _oastConfig: OastConfig | null = null

function getCurrentConfig(): OastConfig | null {
  return getEngagementServices()?.oastConfig ?? _oastConfig
}

function getCurrentStore(): OastStore {
  return getEngagementServices()?.oast ?? legacyStore ?? getGlobalOastStore()
}

export function setOastConfig(config: OastConfig | null): void {
  const services = getEngagementServices()
  if (services) {
    services.oastConfig = config
    const key = storeKeys.get(services.oast)
    const binding = key ? bindings.get(key) : undefined
    if (binding) binding.config = config
    return
  }
  _oastConfig = config
}

/** Callback TTL in ms. Default 1h. */
function getCallbackTtlMs(config = getCurrentConfig()): number {
  if (config?.callbackTtlMs !== undefined) return config.callbackTtlMs
  const envTtl = process.env.OAST_CALLBACK_TTL_MS
  if (envTtl) {
    const n = Number(envTtl)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 3_600_000
}

/**
 * Build the OAST callback URL.
 * Priority: OAST_CALLBACK_HOST env > config.oast.externalHost > local server.
 */
export function getOastUrl(store = getEngagementServices()?.oast): string {
  const routeKey = store ? storeKeys.get(store) : undefined
  const config = routeKey ? bindings.get(routeKey)?.config ?? getCurrentConfig() : getCurrentConfig()
  const ext = process.env.OAST_CALLBACK_HOST || config?.externalHost
  const suffix = routeKey && bindings.has(routeKey) ? `/_oast/${routeKey}` : ''
  if (ext) {
    return `https://${ext}${suffix}`
  }
  if (serverPort === 0) return 'http://oast-not-started'
  return `http://${oastHost}:${serverPort}${suffix}`
}

/** Prune callbacks older than TTL from the store. Returns count removed. */
function pruneStore(store: OastStore, config: OastConfig | null): number {
  const ttlMs = getCallbackTtlMs(config)
  const cutoff = Date.now() - ttlMs
  const all = store.getAll()
  const before = all.length
  store.clear()
  let kept = 0
  for (const cb of all) {
    if (cb.timestamp >= cutoff) {
      store.add(cb)
      kept++
    }
  }
  return before - kept
}

export function pruneExpiredCallbacks(): number {
  return pruneStore(getCurrentStore(), getCurrentConfig())
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', () => resolve(''))
  })
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?')
  if (idx === -1) return {}
  const qs = url.slice(idx + 1)
  const params: Record<string, string> = {}
  for (const part of qs.split('&')) {
    const [k, v] = part.split('=')
    if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : ''
  }
  return params
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || '/'
  const method = (req.method || 'GET').toUpperCase()
  const rawPath = url.split('?')[0]
  const routeMatch = rawPath.match(/^\/_oast\/([^/]+)(\/.*)?$/)
  const binding = routeMatch ? bindings.get(decodeURIComponent(routeMatch[1])) : undefined
  if (routeMatch && !binding) return jsonResponse(res, 404, { ok: false, error: 'unknown OAST engagement' })
  const path = routeMatch ? routeMatch[2] || '/' : rawPath
  const store = binding?.store ?? legacyStore ?? getGlobalOastStore()
  const config = binding?.config ?? _oastConfig

  if (path === '/callbacks' && method === 'GET') {
    pruneStore(store, config)
    return jsonResponse(res, 200, { ok: true, count: store.count(), callbacks: store.getAll() })
  }

  if (path.startsWith('/callbacks/') && method === 'GET') {
    const id = path.replace('/callbacks/', '')
    const cb = store.getById(id)
    if (!cb) return jsonResponse(res, 404, { ok: false, error: 'callback not found' })
    if (cb.timestamp < Date.now() - getCallbackTtlMs(config)) {
      return jsonResponse(res, 410, { ok: false, error: 'callback expired' })
    }
    return jsonResponse(res, 200, { ok: true, callback: cb })
  }

  if (path === '/callbacks' && method === 'DELETE') {
    store.clear()
    return jsonResponse(res, 200, { ok: true, cleared: true })
  }

  if (path === '/health' || path === '/') {
    return jsonResponse(res, 200, { ok: true, service: 'oast', port: serverPort, callbacks: store.count(), externalHost: process.env.OAST_CALLBACK_HOST || config?.externalHost || null })
  }

  // Catch-all: record any request as a callback
  const body = await parseBody(req)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = String(v)
  }

  const callback: OastCallback = {
    id: randomBytes(8).toString('hex'),
    url,
    method,
    headers,
    body,
    query: parseQuery(url),
    timestamp: Date.now(),
    sourceIp: req.socket?.remoteAddress || 'unknown',
  }

  store.add(callback)

  // Structured evidence: an out-of-band callback is hard proof of SSRF/XXE/RCE.
  const recordEvidence = () => recordStructuredEvidence({
      type: 'raw_request',
      data: `${method} ${url}`,
      label: `OAST callback from ${callback.sourceIp}`,
      observed: { method, url: `http://${oastHost}:${serverPort}${path}` },
    })
  if (binding?.services) runWithEngagementServices(binding.services, recordEvidence)
  else recordEvidence()

  jsonResponse(res, 200, { ok: true, recorded: callback.id })
}

export async function startOastServer(port = 0, store?: OastStore): Promise<number> {
  const services = getEngagementServices()
  const ownedStore = store ?? services?.oast
  if (ownedStore) {
    const existingKey = storeKeys.get(ownedStore)
    if (!existingKey || !bindings.has(existingKey)) {
      const key = randomBytes(18).toString('base64url')
      storeKeys.set(ownedStore, key)
      bindings.set(key, { key, store: ownedStore, config: services?.oastConfig ?? _oastConfig, services })
    }
  } else {
    legacyStore ??= getGlobalOastStore()
  }

  if (serverReady) return serverReady
  serverReady = new Promise((resolve, reject) => {
    server = createServer(handleRequest)
    server.listen(port, oastHost, () => {
      const addr = server?.address()
      if (addr && typeof addr === 'object') {
        serverPort = addr.port
      }
      resolve(serverPort)
    })
    server.on('error', (error) => {
      server = null
      serverPort = 0
      serverReady = null
      reject(error)
    })
  })
  return serverReady
}

export async function stopOastServer(store = getEngagementServices()?.oast): Promise<void> {
  if (store) {
    const key = storeKeys.get(store)
    if (key) bindings.delete(key)
    if (bindings.size > 0 || legacyStore) return
  } else {
    bindings.clear()
    legacyStore = null
  }
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => {
      server = null
      serverPort = 0
      serverReady = null
      bindings.clear()
      legacyStore = null
      resolve()
    })
  })
}

export { getGlobalOastStore } from './store'
