import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

function tryParseJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function escapeQuery(value: string): string {
  return encodeURIComponent(value)
}

export const injectInContext = createTool({
  id: 'injectInContext',
  description: 'Take a base URL+method+headers+body and inject a payload at the specified location. Returns a modified request template.',
  inputSchema: z.object({
    baseUrl: z.string(),
    baseMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
    baseHeaders: z.record(z.string()).optional().default({}),
    baseBody: z.string().optional(),
    payload: z.string(),
    location: z.enum(['query', 'body', 'header', 'cookie', 'path', 'filename', 'xml-entity']),
    paramName: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      url: z.string(),
      method: z.string(),
      headers: z.record(z.string()),
      body: z.string().optional(),
      cookies: z.record(z.string()).optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async (ctx) => {
    try {
      const payload = ctx.payload
      const location = ctx.location
      const method = ctx.baseMethod ?? 'GET'
      const headers: Record<string, string> = { ...(ctx.baseHeaders ?? {}) }
      let body = ctx.baseBody ?? ''
      let cookies: Record<string, string> = {}
      let url = ctx.baseUrl

      switch (location) {
        case 'query': {
          const u = new URL(url)
          const key = ctx.paramName ?? Object.keys(u.searchParams)[0] ?? 'q'
          u.searchParams.set(key, payload)
          url = u.toString()
          break
        }
        case 'body': {
          const json = tryParseJson(body)
          if (json) {
            const key = ctx.paramName ?? Object.keys(json)[0] ?? 'data'
            json[key] = payload
            body = JSON.stringify(json)
            headers['content-type'] = 'application/json'
          } else {
            const params = new URLSearchParams(body)
            const key = ctx.paramName ?? Object.keys(Object.fromEntries(params))[0] ?? 'data'
            params.set(key, payload)
            body = params.toString()
            headers['content-type'] = 'application/x-www-form-urlencoded'
          }
          break
        }
        case 'header': {
          const key = ctx.paramName ?? 'X-Custom'
          headers[key] = payload
          break
        }
        case 'cookie': {
          const key = ctx.paramName ?? 'session'
          cookies = { [key]: payload }
          break
        }
        case 'path': {
          const key = ctx.paramName ?? 'id'
          if (url.includes(`{${key}}`)) {
            url = url.replace(`{${key}}`, escapeQuery(payload))
          } else {
            const u = new URL(url)
            const parts = u.pathname.split('/').filter(Boolean)
            if (parts.length > 0) parts[parts.length - 1] = escapeQuery(payload)
            u.pathname = '/' + parts.join('/')
            url = u.toString()
          }
          break
        }
        case 'filename': {
          body = payload
          break
        }
        case 'xml-entity': {
          body = payload
          headers['content-type'] = 'application/xml'
          break
        }
      }

      return { ok: true, value: { url, method, headers, body, cookies } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})


