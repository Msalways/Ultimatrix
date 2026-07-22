import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { log } from '../utils/logger'
import { getForensicLog } from './report-tools'
import { CompressionService } from '../compression/headroom-service'
import { isUrlInScope, getScopeConfig } from '../safety/scope-guard'
import { recordStructuredEvidence } from './control-tools'
import { LoopDetector } from '../intelligence/anti-loop'

const globalLoopDetector = new LoopDetector()

function extractHost(url: string): string | null {
  try { return new URL(url).hostname } catch { return null }
}

function checkBlocked(url: string): { ok: false; error: string } | null {
  const host = extractHost(url)
  if (host && globalLoopDetector.isTargetBlocked(host)) {
    return { ok: false, error: `Target blocked by anti-loop: ${host} has repeated failures` }
  }
  return null
}

// --- Target-aware rate limiting ---
const HOST_DELAY_MS = 200
const hostLastRequest = new Map<string, number>()

function hostKey(url: string): string {
  try { return new URL(url).host } catch { return url }
}

async function waitForHostSlot(url: string): Promise<void> {
  const key = hostKey(url)
  const last = hostLastRequest.get(key) ?? 0
  const elapsed = Date.now() - last
  if (elapsed < HOST_DELAY_MS) {
    await new Promise(r => setTimeout(r, HOST_DELAY_MS - elapsed))
  }
  hostLastRequest.set(key, Date.now())
}

// --- 429 exponential backoff ---
const MAX_429_RETRIES = 3
const BACKOFF_BASE_MS = 1000

async function fetchWithBackoff(url: string, opts: RequestInit, maxRetries = MAX_429_RETRIES): Promise<Response> {
  let lastErr: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts)
    if (res.status !== 429) return res
    const retryAfter = res.headers.get('retry-after')
    const backoffMs = retryAfter
      ? Math.min(Number(retryAfter) * 1000, 30_000)
      : Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), 30_000)
    log.warn(`429 from ${url}, backoff ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`)
    await new Promise(r => setTimeout(r, backoffMs))
    lastErr = new Error(`429 Too Many Requests after ${attempt + 1} retries`)
    hostLastRequest.set(hostKey(url), Date.now())
  }
  throw lastErr ?? new Error('429 Too Many Requests')
}

// --- robots.txt cache ---
const robotsCache = new Map<string, Set<string>>()

async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    const origin = parsed.origin
    if (robotsCache.has(origin)) {
      return !isDisallowed(robotsCache.get(origin)!, parsed.pathname)
    }
    // Fetch and cache robots.txt (only once per origin)
    robotsCache.set(origin, new Set())
    try {
      const res = await fetch(`${origin}/robots.txt`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const text = await res.text()
        const disallowed = parseRobotsDisallows(text)
        robotsCache.set(origin, disallowed)
        return !isDisallowed(disallowed, parsed.pathname)
      }
    } catch { /* robots.txt unavailable — allow all */ }
    return true
  } catch { return true }
}

function parseRobotsDisallows(text: string): Set<string> {
  const disallowed = new Set<string>()
  let inUserAgent = false
  for (const line of text.split('\n')) {
    const trimmed = line.split('#')[0].trim().toLowerCase()
    if (trimmed.startsWith('user-agent:')) {
      const agent = trimmed.slice('user-agent:'.length).trim()
      inUserAgent = agent === '*' || agent.includes('ultimatrix')
    } else if (inUserAgent && trimmed.startsWith('disallow:')) {
      const path = trimmed.slice('disallow:'.length).trim()
      if (path) disallowed.add(path)
    }
  }
  return disallowed
}

function isDisallowed(disallowed: Set<string>, pathname: string): boolean {
  for (const rule of disallowed) {
    if (pathname === rule || pathname.startsWith(rule.endsWith('/') ? rule : rule + '/')) return true
  }
  return false
}

export const httpRequest = createTool({
  id: 'httpRequest',
  description: 'Send an HTTP request with method/headers/body. Does NOT follow redirects.',
  inputSchema: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
    url: z.string().url().describe('Target URL'),
    headers: z.record(z.string(), z.string()).optional().describe('Request headers. Pass auth/session headers previously captured from the target session.'),
    body: z.string().optional().describe('Request body — only valid with POST, PUT, or PATCH'),
    timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
  }).refine(
    (data) => !['GET', 'HEAD'].includes(data.method) || data.body === undefined,
    { message: 'GET and HEAD requests cannot have a body. Use POST/PUT/PATCH for requests with a body.' },
  ),
  execute: async ({  method, url, headers, body, timeoutMs  }) => {
    const start = performance.now()
    try {
      const scopeCheck = isUrlInScope(url)
      if (!scopeCheck.allowed) {
        return { ok: false, error: `Scope violation: ${scopeCheck.reason}` }
      }
      const blocked = checkBlocked(url)
      if (blocked) return blocked
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
      await waitForHostSlot(url)
      const fetchOpts: RequestInit = {
        method,
        headers: headers ?? {},
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs ?? 10000),
      }
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOpts.body = body
      }
      const raw = await fetchWithBackoff(url, fetchOpts)
      const rawBody = await raw.text()
      const compressionResult = await new CompressionService().compressResponse(rawBody)
      const responseBody = compressionResult.compressed
      const resHeaders: Record<string, string> = {}
      raw.headers.forEach((v, k) => { resHeaders[k] = v })
      recordStructuredEvidence({
        type: 'raw_response',
        data: responseBody,
        label: `${method} ${url} → ${raw.status}`,
        observed: { method, url, status: raw.status, responseHeaders: resHeaders, responseBody, responseTimeMs: performance.now() - start, ...(headers ? { requestHeaders: headers } : {}), ...(body ? { requestBody: body } : {}) },
      })
      log.info(`httpRequest ${method} ${url} → ${raw.status}`, { method, url, status: raw.status, durationMs: performance.now() - start, bodySize: responseBody.length, compressed: compressionResult.wasCompressed, truncated: compressionResult.wasTruncated })
      getForensicLog()?.log({
        type: 'http-request',
        agent: 'worker',
        tool: 'httpRequest',
        args: { method, url, headers, body: body?.substring(0, 1000) },
        result: { status: raw.status, headers: resHeaders, bodyLength: responseBody.length },
        duration: Math.round(performance.now() - start),
      })
      return {
        ok: true,
        value: {
          status: raw.status,
          url,
          headers: resHeaders,
          body: responseBody,
          durationMs: performance.now() - start,
        },
      }
    } catch (e) {
      const errMsg = (e as Error).message
      log.warn(`httpRequest ${method} ${url} failed: ${errMsg}`, { method, url, error: errMsg, durationMs: performance.now() - start })
      globalLoopDetector.trackFailedTarget(url, errMsg)
      return {
        ok: false,
        error: errMsg,
      }
    }
  },
})

export function getHttpLoopDetector(): LoopDetector {
  return globalLoopDetector
}

export const multipartUpload = createTool({
  id: 'multipartUpload',
  description: 'Upload a file via multipart/form-data POST.',
  inputSchema: z.object({
    url: z.string().url().describe('Target URL'),
    filename: z.string().describe('Filename for the uploaded file'),
    contentType: z.string().default('application/octet-stream').describe('MIME type of the file content'),
    content: z.string().describe('File content as string'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
  }),
  execute: async ({  url, filename, contentType, content, headers  }) => {
    const start = performance.now()
    try {
      const scopeCheck = isUrlInScope(url)
      if (!scopeCheck.allowed) {
        return { ok: false, error: `Scope violation: ${scopeCheck.reason}` }
      }
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
      await waitForHostSlot(url)
      const formData = new FormData()
      const blob = new Blob([content], { type: contentType })
      formData.append('file', blob, filename)
      const reqHeaders: Record<string, string> = { ...(headers ?? {}) }
      delete reqHeaders['content-type']
      delete reqHeaders['Content-Type']
      const raw = await fetchWithBackoff(url, {
        method: 'POST',
        headers: reqHeaders,
        body: formData,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
      const responseBody = (await new CompressionService().compressResponse(await raw.text())).compressed
      const resHeaders: Record<string, string> = {}
      raw.headers.forEach((v, k) => { resHeaders[k] = v })
      recordStructuredEvidence({
        type: 'raw_response',
        data: responseBody,
        label: `POST ${url} (upload=${filename}) → ${raw.status}`,
        observed: { method: 'POST', url, status: raw.status, responseHeaders: resHeaders, filename, contentType },
      })
      log.info(`multipartUpload POST ${url} (file=${filename}) → ${raw.status}`, { method: 'POST', url, filename, status: raw.status, durationMs: performance.now() - start, bodySize: responseBody.length })
      return {
        ok: true,
        value: {
          status: raw.status,
          url,
          headers: resHeaders,
          body: responseBody,
          durationMs: performance.now() - start,
        },
      }
    } catch (e) {
      log.warn(`multipartUpload POST ${url} failed: ${(e as Error).message}`, { url, filename, error: (e as Error).message, durationMs: performance.now() - start })
      return {
        ok: false,
        error: (e as Error).message,
      }
    }
  },
})

export const followRedirects = createTool({
  id: 'followRedirects',
  description: 'Follow 3xx redirects from a URL up to maxHops and return the final response.',
  inputSchema: z.object({
    url: z.string().url().describe('Starting URL'),
    headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
    maxHops: z.number().int().positive().default(5).describe('Maximum number of redirects to follow'),
  }),
  execute: async ({  url, headers, maxHops  }) => {
    const start = performance.now()
    let currentUrl = url
    let hops = 0
    try {
      const initialCheck = isUrlInScope(url)
      if (!initialCheck.allowed) {
        return { ok: false, error: `Scope violation: ${initialCheck.reason}` }
      }
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
      while (hops < (maxHops ?? 5)) {
        await waitForHostSlot(currentUrl)
        const fetchOpts: RequestInit = {
          method: 'GET',
          headers: headers ?? {},
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        }
        const raw = await fetchWithBackoff(currentUrl, fetchOpts)
        const isRedirect = raw.status >= 300 && raw.status < 400
        const location = raw.headers.get('location')
        if (!isRedirect || !location) {
          const rawBody = await raw.text()
          const compressionResult = await new CompressionService().compressResponse(rawBody)
          const body = compressionResult.compressed
          const resHeaders: Record<string, string> = {}
          raw.headers.forEach((v, k) => { resHeaders[k] = v })
          recordStructuredEvidence({
            type: 'raw_response',
            data: body,
            label: `GET ${url} (redirect-chain, ${hops} hops) → ${raw.status}`,
            observed: { method: 'GET', url: currentUrl, status: raw.status, responseHeaders: resHeaders, hops },
          })
          log.info(`followRedirects ${url} → ${raw.status} (${hops} hops)`, { url, status: raw.status, hops, durationMs: performance.now() - start, bodySize: body.length })
          return {
            ok: true,
            value: {
              status: raw.status,
              url: currentUrl,
              headers: resHeaders,
              body,
              durationMs: performance.now() - start,
            },
          }
        }
        currentUrl = new URL(location, currentUrl).toString()
        const redirectCheck = isUrlInScope(currentUrl)
        if (!redirectCheck.allowed) {
          return { ok: false, error: `Scope violation on redirect: ${redirectCheck.reason}` }
        }
        hops++
      }
      return {
        ok: false,
        error: `Exceeded max redirect hops (${maxHops})`,
      }
    } catch (e) {
      log.warn(`followRedirects ${url} failed: ${(e as Error).message}`, { url, error: (e as Error).message, durationMs: performance.now() - start })
      return {
        ok: false,
        error: (e as Error).message,
      }
    }
  },
})

export const omitHeader = createTool({
  id: 'omitHeader',
  description: 'Send an HTTP request with a specific header removed. Pass the FULL current headers and the name of the one to strip. Useful for testing auth bypass, CSRF protection, and header-dependent security controls.',
  inputSchema: z.object({
    url: z.string().url().describe('Target URL'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
    headers: z.record(z.string(), z.string()).describe('Full current headers — the one named in headerToOmit will be removed'),
    headerToOmit: z.string().describe('Header name to remove from the request'),
    body: z.string().optional().describe('Request body'),
  }).refine(
    (data) => !['GET', 'HEAD'].includes(data.method) || data.body === undefined,
    { message: 'GET and HEAD requests cannot have a body. Use POST/PUT/PATCH for requests with a body.' },
  ),
  execute: async ({  url, method, headers, headerToOmit, body  }) => {
    const start = performance.now()
    try {
      const scopeCheck = isUrlInScope(url)
      if (!scopeCheck.allowed) {
        return { ok: false, error: `Scope violation: ${scopeCheck.reason}` }
      }
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
      await waitForHostSlot(url)
      const stripped = { ...headers }
      delete stripped[headerToOmit]
      const fetchOpts: RequestInit = {
        method,
        headers: stripped,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      }
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOpts.body = body
      }
      const raw = await fetchWithBackoff(url, fetchOpts)
      const rawBody = await raw.text()
      const compressionResult = await new CompressionService().compressResponse(rawBody)
      const responseBody = compressionResult.compressed
      const resHeaders: Record<string, string> = {}
      raw.headers.forEach((v, k) => { resHeaders[k] = v })
      recordStructuredEvidence({
        type: 'raw_response',
        data: responseBody,
        label: `${method} ${url} (omit=${headerToOmit}) → ${raw.status}`,
        observed: { method, url, status: raw.status, responseHeaders: resHeaders, omittedHeader: headerToOmit },
      })
      log.info(`omitHeader ${method} ${url} (omit=${headerToOmit}) → ${raw.status}`, { method, url, omittedHeader: headerToOmit, status: raw.status, durationMs: performance.now() - start, bodySize: responseBody.length })
      return {
        ok: true,
        value: {
          status: raw.status,
          url,
          headers: resHeaders,
          body: responseBody,
          durationMs: performance.now() - start,
          omittedHeader: headerToOmit,
        },
      }
    } catch (e) {
      log.warn(`omitHeader ${method} ${url} failed: ${(e as Error).message}`, { method, url, error: (e as Error).message, durationMs: performance.now() - start })
      return {
        ok: false,
        error: (e as Error).message,
      }
    }
  },
})

