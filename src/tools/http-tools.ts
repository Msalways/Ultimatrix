import { createTool } from '@mastra/core/tools'
import { isBountyProfile } from '../safety/bounty-policy'
import { z } from 'zod'
import { log } from '../utils/logger'
import { getForensicLog } from './report-tools'
import {getCompressionService} from '../compression/headroom-service'
import {isUrlInScope, enforceHttpMethod} from '../safety/scope-guard'
import { getScopeConfig as getScopeConfigSafe } from '../safety/scope-guard'
import { recordStructuredEvidence } from './control-tools'
import { LoopDetector } from '../intelligence/anti-loop'
import { getCapturedRequestStore } from '../capture/captured-request-store'
import { getTargetTransportGovernor } from '../runtime/target-governor'
import { SECRET_NAME, redactHeadersStrict, redactString, redactUrl } from '../security/secret-vault'
import { getGlobalSessionManager } from '../http/session-manager'
import { hasActorIdentityHeader } from '../http/auth-headers'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, type EndpointNode, type PageNode } from '../graph/schema'
import { askUserConfirm } from './interaction-tools'
import { upsertCandidate } from '../research/candidate-store'
import { stableId } from '../research/utils'
import { randomUUID } from 'node:crypto'
import { getEngagementServices } from '../runtime/engagement-context'

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
async function waitForHostSlot(url: string, signal?: AbortSignal | null): Promise<() => void> {
  return getTargetTransportGovernor().acquire(url, 'http-tool', signal ?? undefined)
}

function reserveCampaignRequest(): boolean {
  return getEngagementServices()?.campaignRequestBudget?.() ?? true
}

/** Deny routes with no captured, graph-linked, or operator-supplied source. */
function checkObservedRoute(url: string): string | undefined {
  const policy = getScopeConfigSafe()
  if (policy?.requireObservedRoutes !== true) return undefined

  let requested: URL
  try { requested = new URL(url) } catch { return `Invalid URL: ${url}` }
  try {
    if (/\$\{[^}]+\}/.test(decodeURIComponent(requested.pathname))) {
      return `Unresolved route template blocked: ${requested.pathname} has no concrete target-observed value.`
    }
  } catch { /* the exact observed-route check below still applies */ }
  const params = new Set<string>()
  let observed = false
  const addUrl = (raw: string | undefined): boolean => {
    if (!raw) return false
    try {
      const candidate = new URL(raw)
      if (candidate.origin !== requested.origin || candidate.pathname !== requested.pathname) return false
      observed = true
      candidate.searchParams.forEach((_value, name) => params.add(name))
      return true
    } catch { /* malformed evidence cannot authorize a route */ }
    return false
  }

  // The exact CLI/UI start URL is explicitly operator-authorized.
  addUrl(policy.authorizedStartUrl)

  // Captured request routes are the canonical wire-level evidence source.
  for (const ref of getCapturedRequestStore().list({ host: requested.host })) addUrl(ref.url)

  // The engagement graph also contains target-provided links and routes mined
  // from delivered client code or a captured API schema.
  try {
    const graph = getGlobalGraphStore()
    for (const endpoint of graph.queryNodes(NodeType.ENDPOINT) as EndpointNode[]) {
      if (addUrl(endpoint.properties.url)) {
        for (const parameter of endpoint.properties.params ?? []) params.add(parameter.name)
      }
    }
    for (const page of graph.queryNodes(NodeType.PAGE) as PageNode[]) addUrl(page.properties.url)
  } catch { /* captured traffic or the explicit start URL may still authorize */ }

  if (!observed) {
    return `Unobserved route blocked: ${requested.origin}${requested.pathname} has no captured request, target-linked graph resource, or operator-supplied start URL.`
  }
  const unexpectedParams = [...requested.searchParams.keys()].filter(name => !params.has(name))
  if (unexpectedParams.length) {
    return `Unobserved input blocked: query parameter(s) ${unexpectedParams.join(', ')} were not present in captured or target-provided evidence for ${requested.pathname}.`
  }
  return undefined
}

function inferUnauthenticatedAccessSignal(url: string, status: number, headers: Record<string, string>): string | undefined {
  if (status < 200 || status >= 300) return undefined
  let pathname = ''
  try { pathname = new URL(url).pathname.toLowerCase() } catch { return undefined }
  if (!/(^|\/)(admin|manage|management|config|configuration|internal|private|debug|actuator|metrics)(\/|$)/.test(pathname)) return undefined
  const hasAuth = hasActorIdentityHeader(headers)
  if (hasAuth) return undefined
  return 'In-scope privileged-looking resource returned a successful response without an authentication header.'
}

// --- 429 exponential backoff ---
const MAX_429_RETRIES = 3
const BACKOFF_BASE_MS = 1000
const MAX_APPROVAL_TIMEOUT_MS = 300_000

function isSensitiveApprovalField(name: string): boolean {
  return SECRET_NAME.test(name) || /(?:ticket|otp|one[-_]?time[-_]?code|verification[-_]?code)/i.test(name)
}

function redactApprovalValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return isSensitiveApprovalField(key) ? '<redacted>' : redactString(value)
  if (Array.isArray(value)) return value.map(item => redactApprovalValue(item, key))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.name === 'string' && 'value' in record && isSensitiveApprovalField(record.name)) {
    return { ...record, value: '<redacted>' }
  }
  return Object.fromEntries(Object.entries(record).map(([childKey, child]) => [childKey, redactApprovalValue(child, childKey)]))
}

function redactApprovalUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    const params = [...url.searchParams.entries()]
    url.search = ''
    for (const [name, paramValue] of params) {
      url.searchParams.append(name, isSensitiveApprovalField(name) ? '<redacted>' : redactString(paramValue))
    }
    url.hash = ''
    return redactString(url.toString())
  } catch {
    return redactString(value)
  }
}

function redactApprovalBody(body: string, contentType: string): string {
  try {
    return JSON.stringify(redactApprovalValue(JSON.parse(body)), null, 2)
  } catch { /* try form or text below */ }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return [...new URLSearchParams(body).entries()]
      .map(([name, value]) => `${name}=${isSensitiveApprovalField(name) ? '<redacted>' : redactString(value)}`)
      .join('&')
  }
  if (contentType.startsWith('text/')) {
    return redactString(body).replace(
      /(^|[?&;\s,{])(["']?)([a-z][a-z0-9_.-]*)(["']?)\s*([=:])\s*("[^"]*"|'[^']*'|[^,&;\s}]+)/gi,
      (match, prefix: string, openQuote: string, name: string, closeQuote: string, separator: string) =>
        isSensitiveApprovalField(name) ? `${prefix}${openQuote}${name}${closeQuote}${separator}<redacted>` : match,
    )
  }
  return `[omitted: ${body.length} characters; unsupported content type${contentType ? ` ${contentType}` : ''}]`
}

/** Build the redacted request summary shown before a state-changing HTTP action. */
export function formatRequestApproval(input: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  sessionRef?: string
}): string {
  const headers = redactHeadersStrict(input.headers) ?? {}
  const contentType = Object.entries(input.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.toLowerCase() ?? ''
  return [
    'Approve this state-changing HTTP request?',
    `Method: ${input.method.toUpperCase()}`,
    `URL: ${redactApprovalUrl(input.url)}`,
    `Headers: ${Object.keys(headers).length ? JSON.stringify(headers) : '(none)'}`,
    ...(input.sessionRef ? [`Session: ${redactString(input.sessionRef)} (stored authentication values are hidden)`] : []),
    `Body: ${input.body === undefined ? '(none)' : redactApprovalBody(input.body, contentType)}`,
    'Reply yes to send this request or no to cancel it.',
  ].join('\n')
}

async function fetchWithBackoff(url: string, opts: RequestInit, maxRetries = MAX_429_RETRIES): Promise<Response> {
  let lastErr: Error | undefined
  const method = String(opts.method ?? 'GET').toUpperCase()
  const retryLimit = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? maxRetries : 0
  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    const release = await waitForHostSlot(url, opts.signal)
    let res: Response
    try {
      if (!reserveCampaignRequest()) throw new Error('campaign request/time budget reached')
      res = await fetch(url, opts)
    } finally {
      release()
    }
    if (res.status !== 429) return res
    const retryAfter = res.headers.get('retry-after')
    const backoffMs = retryAfter
      ? Math.min(Number(retryAfter) * 1000, 30_000)
      : Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), 30_000)
    log.warn(`429 from ${url}, backoff ${backoffMs}ms (attempt ${attempt + 1}/${retryLimit})`)
    await new Promise(r => setTimeout(r, backoffMs))
    lastErr = new Error(`429 Too Many Requests after ${attempt + 1} retries`)
  }
  throw lastErr ?? new Error('429 Too Many Requests')
}

// --- robots.txt cache ---
const robotsCache = new Map<string, Set<string>>()

async function isAllowedByRobots(url: string): Promise<boolean> {
  // Authorized pentest engagements skip robots.txt — those disallowed paths are
  // often exactly where vulnerabilities live. The scope-guard already enforces
  // authorization; robots.txt compliance is for crawlers, not pentesters.
  const scopeCfg = getScopeConfigSafe()
  // In an evidence-bound engagement, an implicit robots.txt request would
  // itself be an unobserved path probe. The target can still expose that exact
  // resource through captured traffic if the operator wants to inspect it.
  if (scopeCfg?.authorizedPentest || scopeCfg?.requireObservedRoutes) return true

  try {
    const parsed = new URL(url)
    const origin = parsed.origin
    if (robotsCache.has(origin)) {
      return !isDisallowed(robotsCache.get(origin)!, parsed.pathname)
    }
    // Fetch and cache robots.txt (only once per origin)
    robotsCache.set(origin, new Set())
    try {
      const release = await waitForHostSlot(`${origin}/robots.txt`)
      let res: Response
      try {
        if (!reserveCampaignRequest()) return true
        res = await fetch(`${origin}/robots.txt`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      } finally {
        release()
      }
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
  description: 'Send an HTTP request with method/headers/body. Does NOT follow redirects. Successful results include evidenceId and capturedRequestId; use evidenceId in typed experiment oracles and findings, not graph Fact IDs. The full response is retained behind that evidence reference; body may be compressed for model context.',
  inputSchema: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
    url: z.string().url().describe('Target URL'),
    headers: z.record(z.string(), z.string()).optional().describe('Request headers. Pass auth/session headers previously captured from the target session.'),
    body: z.string().optional().describe('Request body — only valid with POST, PUT, or PATCH'),
    timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
    approvalTimeoutMs: z.number().int().positive().optional().describe('Maximum time to wait for state-changing request approval.'),
    retryOnLimit: z.boolean().optional().describe('Retry idempotent 429 responses; disable when the caller enforces an exact request budget.'),
    sessionRef: z.string().optional().describe('Session reference name (e.g. "admin:https://example.com"). When provided, auto-merges session headers (cookies, bearer token) under any explicit headers. Use useSession or storeSession to create sessions.'),
  }).refine(
    (data) => !['GET', 'HEAD'].includes(data.method) || data.body === undefined,
    { message: 'GET and HEAD requests cannot have a body. Use POST/PUT/PATCH for requests with a body.' },
  ),
  execute: async ({  method, url, headers, body, timeoutMs, approvalTimeoutMs, sessionRef, retryOnLimit  }, context) => {
    const start = performance.now()
    const executionId = randomUUID()
    try {
      enforceHttpMethod(method)
      const scopeCheck = isUrlInScope(url)
      if (!scopeCheck.allowed) {
        return { ok: false, error: `Scope violation: ${scopeCheck.reason}` }
      }
      const routeError = checkObservedRoute(url)
      if (routeError) return { ok: false, error: routeError }
      // Resolve the authentication context before asking for approval so the
      // operator sees the headers that will be sent (with secrets redacted).
      let mergedHeaders: Record<string, string> = { ...(headers ?? {}) }
      if (sessionRef) {
        const sessionHeaders = getGlobalSessionManager().getAllHeaders(sessionRef, url)
        mergedHeaders = { ...sessionHeaders, ...mergedHeaders }
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
        const approved = await askUserConfirm(
          formatRequestApproval({ method, url, headers: mergedHeaders, body, sessionRef }),
          Math.max(1, Math.min(MAX_APPROVAL_TIMEOUT_MS, approvalTimeoutMs ?? MAX_APPROVAL_TIMEOUT_MS)),
        )
        if (!approved) return { ok: false, code: 'APPROVAL_REQUIRED', error: 'State-changing request was not approved.' }
      }
      const blocked = checkBlocked(url)
      if (blocked) return blocked
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
      const timeoutSignal = AbortSignal.timeout(timeoutMs ?? 10000)
      const fetchSignal = context?.abortSignal
        ? AbortSignal.any([context.abortSignal, timeoutSignal])
        : timeoutSignal
      const fetchOpts: RequestInit = {
        method,
        headers: mergedHeaders,
        redirect: 'manual',
        signal: fetchSignal,
      }
      if (body !== undefined && method !== 'GET') {
        fetchOpts.body = body
      }
      const raw = await fetchWithBackoff(url, fetchOpts, retryOnLimit !== false ? MAX_429_RETRIES : 0)
      const rawBody = await raw.text()
      const compressionResult = await getCompressionService().compressResponse(rawBody)
      const responseBody = compressionResult.compressed
      const resHeaders: Record<string, string> = {}
      raw.headers.forEach((v, k) => { resHeaders[k] = v })
      const capturedRequest = getCapturedRequestStore().record({
        method,
        url,
        ...(mergedHeaders ? { headers: mergedHeaders } : {}),
        ...(body !== undefined ? { body } : {}),
        status: raw.status,
        responseHeaders: resHeaders,
        responseBody: rawBody,
        executionId,
      })
      const responseEvidence = recordStructuredEvidence({
        type: 'raw_response',
        data: rawBody,
        label: `${method} ${url} → ${raw.status}`,
        observed: { method, url, status: raw.status, responseHeaders: resHeaders, responseBody: rawBody, responseTimeMs: performance.now() - start, executionId, captureId: capturedRequest.id, ...(mergedHeaders ? { requestHeaders: mergedHeaders } : {}), ...(body ? { requestBody: body } : {}) },
      })
      const accessSignal = inferUnauthenticatedAccessSignal(url, raw.status, mergedHeaders)
      if (accessSignal) {
        const store = getGlobalGraphStore()
        upsertCandidate(store, {
          id: stableId('candidate', ['unauthenticated-access', url]),
          title: 'Potential unauthenticated access to a privileged resource',
          signalType: 'unauthenticated-privileged-resource',
          endpoint: url,
          evidence: [`${method} ${url} returned HTTP ${raw.status}.`, accessSignal],
          experimentIds: [],
          confidence: 0.55,
          nextVerificationSteps: [
            'Repeat from a clean session with cookies and authorization headers removed.',
            'Inspect the response for sensitive or privileged fields.',
            'Confirm the resource is intended to require authorization before reporting.',
          ],
          blockers: ['Requires independent authorization expectation and sensitive-field verification.'],
          status: 'needs-more-evidence',
          severity: 'medium',
        })
        await store.save()
      }
      log.info(`httpRequest ${method} ${url} → ${raw.status}`, { method, url, status: raw.status, durationMs: performance.now() - start, bodySize: responseBody.length, compressed: compressionResult.wasCompressed, truncated: compressionResult.wasTruncated })
      const bountyMode = isBountyProfile()
      getForensicLog()?.log({
        type: 'http-request',
        agent: 'worker',
        tool: 'httpRequest',
        args: {
          method,
          url,
          headers: bountyMode ? (redactHeadersStrict(mergedHeaders) ?? {}) : mergedHeaders,
          ...(body !== undefined ? { body: bountyMode ? redactString(body.substring(0, 1000)) : body.substring(0, 1000) } : {}),
        },
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
          evidenceId: responseEvidence.id,
          capturedRequestId: capturedRequest.id,
          executionId,
          ...(accessSignal ? { securitySignals: [accessSignal] } : {}),
          durationMs: performance.now() - start,
        },
      }
    } catch (e) {
      const errMsg = (e as Error).message
      log.warn(`httpRequest ${method} ${url} failed: ${errMsg}`, { method, url, error: errMsg, durationMs: performance.now() - start })
      try {
        const bountyMode = isBountyProfile()
        getForensicLog()?.log({
          type: 'tool-error',
          agent: 'worker',
          tool: 'httpRequest',
          args: {
            method,
            url: bountyMode ? redactUrl(url) : url,
            timeoutMs: timeoutMs ?? 10_000,
            targetTransport: getTargetTransportGovernor().stats(url),
          },
          error: errMsg,
          duration: Math.round(performance.now() - start),
        })
      } catch { /* failure tracing must never replace the original tool error */ }
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
      enforceHttpMethod('POST')
      const scopeCheck = isUrlInScope(url)
      if (!scopeCheck.allowed) {
        return { ok: false, error: `Scope violation: ${scopeCheck.reason}` }
      }
      const routeError = checkObservedRoute(url)
      if (routeError) return { ok: false, error: routeError }
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
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
      const responseBody = (await getCompressionService().compressResponse(await raw.text())).compressed
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
      enforceHttpMethod('GET')
      const initialCheck = isUrlInScope(url)
      if (!initialCheck.allowed) {
        return { ok: false, error: `Scope violation: ${initialCheck.reason}` }
      }
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
      while (hops < (maxHops ?? 5)) {
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
          const compressionResult = await getCompressionService().compressResponse(rawBody)
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
          url,
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
      enforceHttpMethod(method)
      const scopeCheck = isUrlInScope(url)
      if (!scopeCheck.allowed) {
        return { ok: false, error: `Scope violation: ${scopeCheck.reason}` }
      }
      if (!(await isAllowedByRobots(url))) {
        return { ok: false, error: `Blocked by robots.txt: ${url}` }
      }
      const stripped = { ...headers }
      delete stripped[headerToOmit]
      const fetchOpts: RequestInit = {
        method,
        headers: stripped,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      }
      if (body !== undefined && method !== 'GET') {
        fetchOpts.body = body
      }
      const raw = await fetchWithBackoff(url, fetchOpts)
      const rawBody = await raw.text()
      const compressionResult = await getCompressionService().compressResponse(rawBody)
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
