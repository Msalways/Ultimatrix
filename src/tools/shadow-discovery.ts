/**
 * Mine already captured, same-origin responses for API routes.
 *
 * Discovery is passive: this tool never constructs a URL to request. Route
 * candidates must come from a captured response body (delivered client code,
 * links, or an API schema) and retain the capture id that supplied them.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getCapturedRequestStore } from '../capture/captured-request-store'
import { mineJsEndpoints } from '../capture/js-miner'
import { isUrlInScope } from '../safety/scope-guard'

export const shadowApiDiscovery = createTool({
  id: 'shadowApiDiscovery',
  description:
    'Passively mine already captured same-origin HTML, JavaScript, and API-schema responses for endpoint candidates. Never sends HTTP requests or invents paths.',
  inputSchema: z.object({
    baseUrl: z.string().url().describe('Observed target origin whose captured responses may be mined.'),
  }).strict(),
  outputSchema: z.object({
    ok: z.boolean(),
    endpoints: z.array(z.object({ path: z.string(), source: z.string(), relevant: z.boolean(), inScope: z.boolean() })),
    error: z.string().optional(),
  }),
  execute: async ({ baseUrl }) => {
    let origin: URL
    try { origin = new URL(baseUrl) } catch { return { ok: false, endpoints: [], error: 'invalid base URL' } }
    const scope = isUrlInScope(origin.origin)
    if (!scope.allowed) return { ok: false, endpoints: [], error: `out of scope: ${scope.reason}` }

    const relevanceSignals = ['admin', 'internal', 'debug', 'manage', 'secret', 'config', 'console', 'private']
    const found = new Map<string, { path: string; source: string }>()
    const add = (candidate: string | undefined, source: string) => {
      if (!candidate) return
      try {
        const parsed = new URL(candidate, origin)
        if (parsed.origin !== origin.origin || !isUrlInScope(parsed.toString()).allowed) return
        const path = `${parsed.pathname}${parsed.search}`
        if (path === '/') return
        if (!found.has(path)) found.set(path, { path, source })
      } catch { /* malformed strings are not endpoint evidence */ }
    }

    const captureStore = getCapturedRequestStore()
    for (const ref of captureStore.list({ host: origin.host })) {
      const entry = captureStore.get(ref.id)
      const body = entry?.responseBody
      if (!body) continue
      let responseUrl: URL
      try { responseUrl = new URL(ref.url) } catch { continue }
      if (responseUrl.origin !== origin.origin) continue

      const contentType = Object.entries(entry?.responseHeaders ?? {})
        .find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.toLowerCase() ?? ''
      if (!/(?:javascript|ecmascript|text\/html|application\/json|\+json)/.test(contentType)) continue

      const captureRef = `${ref.id}:${responseUrl.pathname}`
      for (const candidate of mineJsEndpoints(body, responseUrl.toString())) {
        if (!candidate.inScope || !candidate.url) continue
        add(candidate.url, `${captureRef}:client-${candidate.source}`)
      }

      // An API schema is useful only when the schema itself was captured from
      // a target-provided link or client request; its operation paths are not
      // probed here.
      try {
        const document = JSON.parse(body)
        if (document?.paths && typeof document.paths === 'object') {
          for (const path of Object.keys(document.paths)) add(path, `${captureRef}:captured-api-schema`)
        }
      } catch { /* response was not JSON */ }
    }

    const endpoints = [...found.entries()].map(([path, meta]) => ({
      path,
      source: meta.source,
      relevant: relevanceSignals.some(signal => path.toLowerCase().includes(signal)),
      inScope: isUrlInScope(new URL(path, origin).toString()).allowed,
    }))
    return { ok: true, endpoints }
  },
})
