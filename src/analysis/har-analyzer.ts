import type { HarArchive, HarEntry, Endpoint, Secret, DataFlow } from '../capture/har-parser'
import { getEndpoints, getSecrets, getDataFlows, getUniqueHosts, getRequestMethods } from '../capture/har-parser'

export interface AnalysisResult {
  endpoints: Endpoint[]
  secrets: Secret[]
  dataFlows: DataFlow[]
  hosts: string[]
  methods: Record<string, number>
  summary: string
}

export interface Pattern {
  type: string
  description: string
  evidence: string[]
  confidence: number
}

export interface Hypothesis {
  id: string
  title: string
  description: string
  attackVector: string
  targetEndpoints: string[]
  confidence: number
  patterns: Pattern[]
}

export function analyzeHar(archive: HarArchive): AnalysisResult {
  const entries = archive.log.entries

  const endpoints = getEndpoints(entries)
  const secrets = getSecrets(entries)
  const dataFlows = getDataFlows(entries)
  const hosts = getUniqueHosts(entries)
  const methods = getRequestMethods(entries)

  const summary = buildSummary(endpoints, secrets, dataFlows, hosts, methods)

  return {
    endpoints,
    secrets,
    dataFlows,
    hosts,
    methods,
    summary,
  }
}

export function identifyPatterns(entries: HarEntry[]): Pattern[] {
  const patterns: Pattern[] = []

  // Pattern: Endpoint with user-controlled input in URL
  const urlParams = new Map<string, number>()
  for (const entry of entries) {
    const url = new URL(entry.request.url)
    for (const [key] of url.searchParams) {
      urlParams.set(key, (urlParams.get(key) || 0) + 1)
    }
  }

  if (urlParams.size > 0) {
    patterns.push({
      type: 'url-parameters',
      description: 'Endpoints with URL parameters that may be exploitable',
      evidence: Array.from(urlParams.entries()).map(([k, v]) => `Parameter "${k}" used ${v} times`),
      confidence: 0.6,
    })
  }

  // Pattern: JSON request/response bodies
  const jsonEndpoints = entries.filter(e =>
    e.request.postData?.mimeType?.includes('application/json') ||
    e.response.content.mimeType?.includes('application/json')
  )

  if (jsonEndpoints.length > 0) {
    patterns.push({
      type: 'json-api',
      description: 'JSON API endpoints detected',
      evidence: jsonEndpoints.map(e => `${e.request.method} ${new URL(e.request.url).pathname}`),
      confidence: 0.8,
    })
  }

  // Pattern: Authentication — canonical Authorization header (value-based
  // bearer/basic detection lives in analyseAuth/resolveScheme, the single
  // owner of scheme classification). We do not guess auth from arbitrary
  // header names here.
  const authHeaders = entries.filter(e =>
    e.request.headers.some(h =>
      h.name.toLowerCase() === 'authorization'
    )
  )

  if (authHeaders.length > 0) {
    patterns.push({
      type: 'authentication',
      description: 'Endpoints using authentication tokens',
      evidence: authHeaders.map(e => `${e.request.method} ${new URL(e.request.url).pathname}`),
      confidence: 0.9,
    })
  }

  // Pattern: Cookie-based sessions — canonical session-cookie name patterns
  // (vendor/standard session identifiers, not a guess over arbitrary names).
  const SESSION_COOKIE = /^(session|sess|sid|jsessionid|phpsessid|aspsessionid|connect\.sid)/i
  const cookieSessions = entries.filter(e =>
    e.request.cookies.some(c => SESSION_COOKIE.test(c.name))
  )

  if (cookieSessions.length > 0) {
    patterns.push({
      type: 'cookie-session',
      description: 'Cookie-based session management detected',
      evidence: cookieSessions.map(e => `Cookie: ${e.request.cookies.map(c => c.name).join(', ')}`),
      confidence: 0.85,
    })
  }

  // Pattern: Error responses
  const errorResponses = entries.filter(e => e.response.status >= 400)
  if (errorResponses.length > 0) {
    patterns.push({
      type: 'error-responses',
      description: 'Endpoints returning error responses may reveal information',
      evidence: errorResponses.map(e => `${e.response.status} ${new URL(e.request.url).pathname}`),
      confidence: 0.5,
    })
  }

  // Pattern: File uploads
  const fileUploads = entries.filter(e =>
    e.request.postData?.mimeType?.includes('multipart/form-data')
  )

  if (fileUploads.length > 0) {
    patterns.push({
      type: 'file-upload',
      description: 'File upload endpoints detected',
      evidence: fileUploads.map(e => `${e.request.method} ${new URL(e.request.url).pathname}`),
      confidence: 0.7,
    })
  }

  // Pattern: Form submissions
  const formSubmissions = entries.filter(e =>
    e.request.postData?.mimeType?.includes('application/x-www-form-urlencoded')
  )

  if (formSubmissions.length > 0) {
    patterns.push({
      type: 'form-submission',
      description: 'HTML form submissions detected',
      evidence: formSubmissions.map(e => `${e.request.method} ${new URL(e.request.url).pathname}`),
      confidence: 0.7,
    })
  }

  return patterns
}

export function generateHypotheses(patterns: Pattern[], endpoints: Endpoint[]): Hypothesis[] {
  const hypotheses: Hypothesis[] = []

  // Hypothesis: IDOR potential if there are endpoints with IDs
  const idEndpoints = endpoints.filter(e =>
    /\/\d+\/?/.test(e.path) || /\/[a-f0-9-]{20,}\/?/.test(e.path)
  )

  if (idEndpoints.length > 0) {
    hypotheses.push({
      id: 'idor-potential',
      title: 'Potential IDOR Vulnerability',
      description: 'Endpoints with numeric or UUID-like identifiers may be vulnerable to IDOR',
      attackVector: 'Manipulate ID parameters to access unauthorized resources',
      targetEndpoints: idEndpoints.map(e => `${e.method} ${e.url}`),
      confidence: 0.6,
      patterns: patterns.filter(p => p.type === 'authentication'),
    })
  }

  // Hypothesis: Missing authorization
  const authPatterns = patterns.filter(p => p.type === 'authentication')
  const nonAuthEndpoints = endpoints.filter(e =>
    !authPatterns.some(p => p.evidence.some(ev => ev.includes(e.path)))
  )

  if (nonAuthEndpoints.length > 0 && authPatterns.length > 0) {
    hypotheses.push({
      id: 'missing-auth',
      title: 'Potential Missing Authorization',
      description: 'Some endpoints may not require authentication',
      attackVector: 'Access endpoints without valid tokens',
      targetEndpoints: nonAuthEndpoints.map(e => `${e.method} ${e.url}`),
      confidence: 0.5,
      patterns: authPatterns,
    })
  }

  // Hypothesis: SQL injection in parameters
  const paramEndpoints = endpoints.filter(e =>
    Object.keys(e.queryParams).length > 0
  )

  if (paramEndpoints.length > 0) {
    hypotheses.push({
      id: 'sqli-potential',
      title: 'Potential SQL Injection',
      description: 'Endpoints with query parameters may be vulnerable to SQL injection',
      attackVector: 'Inject SQL payloads in query parameters',
      targetEndpoints: paramEndpoints.map(e => `${e.method} ${e.url}`),
      confidence: 0.4,
      patterns: patterns.filter(p => p.type === 'json-api'),
    })
  }

  // Hypothesis: Information disclosure
  const errorPatterns = patterns.filter(p => p.type === 'error-responses')
  if (errorPatterns.length > 0) {
    hypotheses.push({
      id: 'info-disclosure',
      title: 'Potential Information Disclosure',
      description: 'Error responses may reveal internal information',
      attackVector: 'Trigger errors to extract information',
      targetEndpoints: errorPatterns.flatMap(p => p.evidence),
      confidence: 0.5,
      patterns: errorPatterns,
    })
  }

  return hypotheses
}

function buildSummary(
  endpoints: Endpoint[],
  secrets: Secret[],
  dataFlows: DataFlow[],
  hosts: string[],
  methods: Record<string, number>
): string {
  const lines: string[] = []

  lines.push('## Analysis Summary')
  lines.push(`- ${endpoints.length} unique endpoints discovered`)
  lines.push(`- ${secrets.length} potential secrets/tokens identified`)
  lines.push(`- ${dataFlows.length} data flow relationships tracked`)
  lines.push(`- ${hosts.length} unique hosts`)
  lines.push(`- HTTP methods: ${Object.entries(methods).map(([m, c]) => `${m}(${c})`).join(', ')}`)

  if (secrets.length > 0) {
    lines.push('\n### Notable Secrets')
    for (const secret of secrets.slice(0, 5)) {
      lines.push(`- ${secret.type} in ${secret.location}: ${secret.description}`)
    }
  }

  if (dataFlows.length > 0) {
    lines.push('\n### Data Flows')
    for (const flow of dataFlows.slice(0, 5)) {
      lines.push(`- ${flow.source.location} → ${flow.sink.location} (${flow.type})`)
    }
  }

  return lines.join('\n')
}
