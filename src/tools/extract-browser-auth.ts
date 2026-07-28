import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getActivePage } from '../browser/manager'

export const extractBrowserAuth = createTool({
  id: 'extractBrowserAuth',
  description: 'Extract authentication tokens from the browser: localStorage, sessionStorage, and cookies. Use after navigating to an authenticated page to capture auth state for session reuse.',
  inputSchema: z.object({
    includeCookies: z.boolean().default(true).describe('Include document.cookie in output'),
    includeLocalStorage: z.boolean().default(true).describe('Include localStorage keys/values'),
    includeSessionStorage: z.boolean().default(true).describe('Include sessionStorage keys/values'),
    filterKeys: z.array(z.string()).optional().describe('Only extract keys matching these patterns (case-insensitive substring match). If empty, extract all.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      localStorage: z.record(z.string(), z.string()),
      sessionStorage: z.record(z.string(), z.string()),
      cookies: z.array(z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
        sameSite: z.string(),
      })),
      cookieString: z.string(),
      url: z.string(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ includeCookies, includeLocalStorage, includeSessionStorage, filterKeys }) => {
    const page = getActivePage()
    if (!page) {
      return { ok: false, error: 'No browser page available' }
    }

    try {
      const currentUrl = page.url()

      const localStorageData = includeLocalStorage
        ? await page.evaluate(() => {
            const data: Record<string, string> = {}
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i)
              if (key) data[key] = window.localStorage.getItem(key) ?? ''
            }
            return data
          })
        : {}

      const sessionStorageData = includeSessionStorage
        ? await page.evaluate(() => {
            const data: Record<string, string> = {}
            for (let i = 0; i < window.sessionStorage.length; i++) {
              const key = window.sessionStorage.key(i)
              if (key) data[key] = window.sessionStorage.getItem(key) ?? ''
            }
            return data
          })
        : {}

      const cookies = includeCookies
        ? await page.evaluate(() => {
            return document.cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => {
              const [name, ...rest] = c.split('=')
              return { name, value: rest.join('='), domain: location.hostname, path: '/', httpOnly: false, secure: location.protocol === 'https:', sameSite: 'Lax' }
            })
          })
        : []

      const filterSet = filterKeys && filterKeys.length > 0
        ? filterKeys.map(k => k.toLowerCase())
        : null

      const filterObj = (obj: Record<string, string>): Record<string, string> => {
        if (!filterSet) return obj
        const result: Record<string, string> = {}
        for (const [k, v] of Object.entries(obj)) {
          if (filterSet.some(f => k.toLowerCase().includes(f))) {
            result[k] = v
          }
        }
        return result
      }

      const filteredLocal = filterObj(localStorageData)
      const filteredSession = filterObj(sessionStorageData)

      const cookieString = cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ')

      return {
        ok: true,
        value: {
          localStorage: filteredLocal,
          sessionStorage: filteredSession,
          cookies,
          cookieString,
          url: currentUrl,
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
