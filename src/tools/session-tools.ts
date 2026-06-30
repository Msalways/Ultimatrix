import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalSessionManager } from '../http/session-manager'

export const extractSessionCookie = createTool({
  id: 'extractSessionCookie',
  description: 'Parse Set-Cookie headers from HTTP response headers',
  inputSchema: z.object({
    responseHeaders: z.record(z.string(), z.string()),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      cookies: z.record(z.string(), z.string()),
    }),
  }),
  execute: async (ctx) => {
    const cookies: Record<string, string> = {}
    for (const [key, value] of Object.entries(ctx.responseHeaders)) {
      if (key.toLowerCase() === 'set-cookie') {
        const match = String(value ?? '').match(/^([^=]+)=([^;]*)/)
        if (match) {
          cookies[match[1]] = match[2]
        }
      }
    }
    return { ok: true, value: { cookies } }
  },
})

export const extractCsrfToken = createTool({
  id: 'extractCsrfToken',
  description: 'Scan HTML for CSRF token input fields',
  inputSchema: z.object({
    html: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      tokenName: z.string().optional(),
      tokenValue: z.string().optional(),
      allCandidates: z.array(z.object({
        name: z.string(),
        value: z.string(),
      })),
    }),
  }),
  execute: async (ctx) => {
    const regex = /<input[^>]+name=["']([^"']*(?:csrf|token|xsrf|authenticity)[^"']*)["'][^>]*value=["']([^"']*)["']/gi
    const allCandidates: { name: string; value: string }[] = []
    let match
    while ((match = regex.exec(ctx.html)) !== null) {
      allCandidates.push({ name: match[1], value: match[2] })
    }
    const first = allCandidates[0]
    return {
      ok: allCandidates.length > 0,
      value: {
        tokenName: first?.name,
        tokenValue: first?.value,
        allCandidates,
      },
    }
  },
})

export const useSession = createTool({
  id: 'useSession',
  description: 'Create or retrieve a session for a role. Stores cookies and tokens in the shared SessionManager so other workers can use them. After login, call this with cookies/token to persist. Before making requests, call this to get stored auth.',
  inputSchema: z.object({
    role: z.string().describe('Session role (e.g. "admin", "user", "guest")'),
    url: z.string().url().describe('Base URL for the session'),
    cookies: z.record(z.string(), z.string()).optional().describe('Session cookies to store (from Set-Cookie or browser)'),
    token: z.string().optional().describe('Bearer token to store'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      role: z.string(),
      sessionName: z.string(),
      cookies: z.record(z.string(), z.string()),
      token: z.string().nullable(),
      headers: z.record(z.string(), z.string()),
    }),
  }),
  execute: async (ctx) => {
    const mgr = getGlobalSessionManager()
    const { role, url, cookies, token } = ctx

    let baseUrl: string
    try {
      const urlObj = new URL(url)
      baseUrl = `${urlObj.origin}`
    } catch {
      baseUrl = url
    }

    const sessionName = `${role}:${baseUrl}`
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

    const headers = mgr.getAllHeaders(sessionName)

    return {
      ok: true,
      value: {
        role,
        sessionName,
        cookies: session.cookies,
        token: session.token,
        headers,
      },
    }
  },
})
