import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { getGlobalOastStore, OastCallback } from './store'
import { recordStructuredEvidence } from '../tools/control-tools'
import type { OastConfig } from '../config'

let server: ReturnType<typeof createServer> | null = null
let serverPort = 0
const oastHost = 'localhost'

let _oastConfig: OastConfig | null = null

export function setOastConfig(config: OastConfig | null): void {
  _oastConfig = config
}

/** Callback TTL in ms. Default 1h. */
function getCallbackTtlMs(): number {
  if (_oastConfig?.callbackTtlMs !== undefined) return _oastConfig.callbackTtlMs
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
export function getOastUrl(): string {
  const ext = process.env.OAST_CALLBACK_HOST || _oastConfig?.externalHost
  if (ext) {
    return `https://${ext}`
  }
  if (serverPort === 0) return 'http://oast-not-started'
  return `http://${oastHost}:${serverPort}`
}

/** Prune callbacks older than TTL from the store. Returns count removed. */
export function pruneExpiredCallbacks(): number {
  const store = getGlobalOastStore()
  const ttlMs = getCallbackTtlMs()
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
  const path = url.split('?')[0]

  if (path === '/callbacks' && method === 'GET') {
    pruneExpiredCallbacks()
    const store = getGlobalOastStore()
    return jsonResponse(res, 200, { ok: true, count: store.count(), callbacks: store.getAll() })
  }

  if (path.startsWith('/callbacks/') && method === 'GET') {
    const id = path.replace('/callbacks/', '')
    const store = getGlobalOastStore()
    const cb = store.getById(id)
    if (!cb) return jsonResponse(res, 404, { ok: false, error: 'callback not found' })
    if (cb.timestamp < Date.now() - getCallbackTtlMs()) {
      return jsonResponse(res, 410, { ok: false, error: 'callback expired' })
    }
    return jsonResponse(res, 200, { ok: true, callback: cb })
  }

  if (path === '/callbacks' && method === 'DELETE') {
    const store = getGlobalOastStore()
    store.clear()
    return jsonResponse(res, 200, { ok: true, cleared: true })
  }

  if (path === '/health' || path === '/') {
    return jsonResponse(res, 200, { ok: true, service: 'oast', port: serverPort, callbacks: getGlobalOastStore().count(), externalHost: process.env.OAST_CALLBACK_HOST || _oastConfig?.externalHost || null })
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

  getGlobalOastStore().add(callback)

  // Structured evidence: an out-of-band callback is hard proof of SSRF/XXE/RCE.
  recordStructuredEvidence({
    type: 'raw_request',
    data: `${method} ${url}`,
    label: `OAST callback from ${callback.sourceIp}`,
    observed: { method, url: `http://${oastHost}:${serverPort}${path}` },
  })

  jsonResponse(res, 200, { ok: true, recorded: callback.id })
}

export async function startOastServer(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(serverPort)
      return
    }

    server = createServer(handleRequest)
    server.listen(port, oastHost, () => {
      const addr = server?.address()
      if (addr && typeof addr === 'object') {
        serverPort = addr.port
      }
      resolve(serverPort)
    })
    server.on('error', reject)
  })
}

export async function stopOastServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => {
      server = null
      serverPort = 0
      resolve()
    })
  })
}

export { getGlobalOastStore } from './store'
