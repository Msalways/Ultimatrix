import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { EndpointNode } from '../graph/schema'
import { getGlobalSessionManager } from '../http/session-manager'

export const getCapturedHeaders = createTool({
  id: 'getCapturedHeaders',
  description: 'Retrieve captured headers (auth tokens, cookies, CSRF tokens) for a URL, providing the real auth context the browser used for its requests.',
  inputSchema: z.object({
    url: z.string().describe('Target URL or URL pattern to match'),
    role: z.string().optional().describe('Session role (e.g. "admin", "user"). If provided, looks up role-specific session first.'),
  }),
  outputSchema: z.object({
    headers: z.record(z.string(), z.string()),
    authType: z.string().nullable(),
    source: z.string(),
  }),
  execute: async ({ url, role }) => {

    // 1. Try role-specific session from SessionManager first
    if (role) {
      const mgr = getGlobalSessionManager()
      const sessionName = `${role}:${url}`
      const session = mgr.getSession(sessionName)
      if (session) {
        const headers = mgr.getAllHeaders(sessionName)
        return {
          ok: true,
          value: { headers, authType: session.token ? 'bearer' : 'cookie', source: 'session-manager' },
        }
      }

      // Try with base URL (strip path)
      try {
        const urlObj = new URL(url)
        const baseUrl = `${urlObj.origin}`
        const baseSession = mgr.getSession(`${role}:${baseUrl}`)
        if (baseSession) {
          const headers = mgr.getAllHeaders(`${role}:${baseUrl}`)
          return {
            ok: true,
            value: { headers, authType: baseSession.token ? 'bearer' : 'cookie', source: 'session-manager' },
          }
        }
      } catch { /* fall through */ }
    }

    // 2. Fall back to graph endpoint headers
    const store = getGlobalGraphStore()
    const endpoints = store.queryNodes(NodeType.ENDPOINT) as EndpointNode[]

    // Exact match first
    let match = endpoints.find(e => e.properties.url === url)
    if (!match) {
      // Path prefix match
      try {
        const urlObj = new URL(url)
        match = endpoints.find(e => {
          try {
            const epUrl = new URL(e.properties.url)
            return epUrl.origin === urlObj.origin && urlObj.pathname.startsWith(epUrl.pathname)
          } catch { return false }
        })
      } catch { /* fall through */ }
    }
    if (!match) {
      // Substring match
      match = endpoints.find(e => url.includes(e.properties.url) || e.properties.url.includes(url))
    }

    if (match && match.properties.headers && Object.keys(match.properties.headers).length > 0) {
      return {
        ok: true,
        value: {
          headers: match.properties.headers,
          authType: match.properties.authType || null,
          source: 'graph',
        },
      }
    }

    return {
      ok: true,
      value: { headers: {}, authType: null, source: 'none' },
    }
  },
})

export const storeSession = createTool({
  id: 'storeSession',
  description: 'Store session state (cookies, auth token) for a role. Writes to both SessionManager (runtime) and graph (durable). Call this after login or session discovery.',
  inputSchema: z.object({
    url: z.string().describe('Base URL for the session (e.g. "https://example.com")'),
    role: z.string().describe('Role name (e.g. "admin", "user", "guest")'),
    cookies: z.record(z.string(), z.string()).optional().describe('Session cookies'),
    token: z.string().optional().describe('Bearer token or API key'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional headers to store'),
  }),
  outputSchema: z.object({
    stored: z.boolean(),
    sessionName: z.string(),
    headerCount: z.number(),
  }),
  execute: async ({ url, role, cookies, token, headers }) => {

    let baseUrl: string
    try {
      const urlObj = new URL(url)
      baseUrl = `${urlObj.origin}`
    } catch {
      baseUrl = url
    }

    const sessionName = `${role}:${baseUrl}`
    const mgr = getGlobalSessionManager()

    // Create or get session in SessionManager (runtime)
    let session = mgr.getSession(sessionName)
    if (!session) {
      session = mgr.createSession(sessionName, baseUrl)
    }
    if (cookies) {
      for (const [k, v] of Object.entries(cookies)) {
        session.cookies[k] = v
      }
    }
    if (token) {
      mgr.setToken(sessionName, token)
    }

    // Build full headers for graph storage
    const allHeaders: Record<string, string> = { ...(headers || {}) }
    if (token) {
      allHeaders['Authorization'] = `Bearer ${token}`
    }
    if (cookies && Object.keys(cookies).length > 0) {
      allHeaders['Cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }

    // Persist to graph (durable)
    if (Object.keys(allHeaders).length > 0) {
      const store = getGlobalGraphStore()
      store.addEndpoint({
        url: baseUrl,
        method: 'GET',
        params: [],
        headers: allHeaders,
        authRequired: true,
        authType: token ? 'bearer' : 'cookie',
        tags: [role],
        source: 'worker-session',
      })
    }

    return {
      ok: true,
      value: {
        stored: true,
        sessionName,
        headerCount: Object.keys(allHeaders).length,
      },
    }
  },
})
