import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const extractSessionCookie = createTool({
  id: 'extractSessionCookie',
  description: 'Parse Set-Cookie headers from HTTP response headers',
  inputSchema: z.object({
    responseHeaders: z.record(z.string()),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      cookies: z.record(z.string()),
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
  description: 'Configure session context with role, cookies, and bearer token',
  inputSchema: z.object({
    role: z.string().default('guest'),
    cookies: z.record(z.string()).optional(),
    bearerToken: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      role: z.string(),
      cookies: z.record(z.string()).optional(),
      bearerToken: z.string().optional(),
    }),
  }),
  execute: async (ctx) => {
    return {
      ok: true,
      value: {
        role: ctx.role ?? 'guest',
        cookies: ctx.cookies,
        bearerToken: ctx.bearerToken,
      },
    }
  },
})
