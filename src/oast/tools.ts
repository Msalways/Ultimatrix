import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {getOastUrl, getGlobalOastStore} from './server'

export const getOastUrlTool = createTool({
  id: 'getOastUrlTool',
  description: 'Get the OAST callback URL for blind payload detection (XSS, SSRF, SQLi, XXE). Returns the HTTP endpoint to inject into payloads.',
  inputSchema: z.object({}),
  execute: async () => {
    return { ok: true, url: getOastUrl() }
  },
})

export const checkOastCallbacks = createTool({
  id: 'checkOastCallbacks',
  description: 'Check for incoming OAST callbacks. Optionally filter by ID to check a specific callback. Returns callbacks with URL, headers, body, timestamp.',
  inputSchema: z.object({
    id: z.string().optional(),
    urlPattern: z.string().optional(),
    since: z.number().optional(),
    limit: z.number().optional().default(20),
  }),
  execute: async ({ id, urlPattern, since, limit }) => {
    try {
      const store = getGlobalOastStore()
      let callbacks = store.getAll()

      if (id) {
        const cb = store.getById(id)
        return { ok: true, callbacks: cb ? [cb] : [] }
      }

      if (urlPattern) {
        callbacks = store.getByUrl(urlPattern)
      }

      if (since) {
        callbacks = callbacks.filter(c => c.timestamp >= since)
      }

      return { ok: true, count: callbacks.length, callbacks: callbacks.slice(0, limit || 20) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const clearOastCallbacks = createTool({
  id: 'clearOastCallbacks',
  description: 'Clear all recorded OAST callbacks.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const store = getGlobalOastStore()
      store.clear()
      return { ok: true, cleared: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})