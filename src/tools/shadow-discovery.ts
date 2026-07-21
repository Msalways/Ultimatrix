/**
 * shadowApiDiscovery — enumerate undocumented / shadow API endpoints
 * (OWASP BLA10 "Undefined Action / Shadow API").
 *
 * Crawls a target's JS bundles + common OpenAPI/doc paths + version-prefixed
 * routes to surface admin/undocumented endpoints that the published API omits.
 * Every discovered endpoint is returned as STRUCTURED data (typed shape) and
 * scope-checked, so the LLM reasons over discovered facts, not prose.
 *
 * Reuses the graph's findEndpointsInResponse observation oracle + recon scope
 * guard. No hardcoded endpoint-name vocabulary — paths come from the live
 * responses. Seed words (admin/api/internal) are DATA used only to *score*
 * relevance, never to detect a fixed list.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { httpRequest } from './http-tools'
import { isUrlInScope } from '../safety/scope-guard'
import { observeEndpoints } from '../primitives/observers'

const SEED_PATHS = ['/openapi.json', '/api/openapi.json', '/swagger.json', '/swagger/v1/swagger.json', '/v1/openapi.json', '/docs', '/api-docs']
const VERSION_PREFIXES = ['/v1', '/v2', '/v3', '/api/v1', '/api/v2']
// Relevance scoring words (data, not a detection vocabulary).
const RELEVANCE = ['admin', 'internal', 'debug', 'manage', 'secret', 'config', 'console', 'backdoor', 'private', 'test']

export const shadowApiDiscovery = createTool({
  id: 'shadowApiDiscovery',
  description:
    'Discover shadow/undocumented API endpoints by mining JS bundles, OpenAPI specs, and version-prefixed routes. Returns structured endpoint candidates (typed), scope-checked. Use to find admin/internal paths the published API omits (BLA10).',
  inputSchema: z.object({
    baseUrl: z.string().url().describe('Target origin to enumerate from.'),
    jsBundles: z.array(z.string()).optional().describe('Known JS bundle URLs to mine for endpoint strings.'),
    extraSeeds: z.array(z.string()).optional().describe('Additional path seeds to probe (e.g. /admin, /internal).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    endpoints: z.array(z.object({ path: z.string(), source: z.string(), relevant: z.boolean(), inScope: z.boolean() })),
    error: z.string().optional(),
  }),
  execute: async (ctx) => {
    const base = ctx.baseUrl.replace(/\/$/, '')
    const scope = isUrlInScope(base)
    if (!scope.allowed) return { ok: false, endpoints: [], error: `out of scope: ${scope.reason}` }

    const found = new Map<string, { path: string; source: string }>()
    const add = (path: string, source: string) => {
      if (!path || path.startsWith('http')) return
      const p = path.startsWith('/') ? path : `/${path}`
      if (!found.has(p)) found.set(p, { path: p, source })
    }

    // Probe OpenAPI / doc seeds.
    for (const seed of [...SEED_PATHS, ...(ctx.extraSeeds ?? [])]) {
      try {
        const r: any = await (httpRequest as any).execute({ method: 'GET', url: `${base}${seed}`, headers: {} })
        if (r?.ok && r.value?.body) {
          const eps = await observeEndpoints(r.value.body as string, base)
          eps.forEach((e: string) => add(e, seed))
          // Swagger/OpenAPI JSON paths.
          try {
            const spec = JSON.parse(r.value.body as string)
            const paths = Object.keys(spec.paths ?? {})
            paths.forEach((p) => add(p, seed))
          } catch { /* not a spec */ }
        }
      } catch { /* ignore probe failures */ }
    }

    // Mine JS bundles for path-like strings.
    for (const bundle of ctx.jsBundles ?? []) {
      try {
        const r: any = await (httpRequest as any).execute({ method: 'GET', url: bundle, headers: {} })
        if (r?.ok && r.value?.body) {
          const eps = await observeEndpoints(r.value.body as string, base)
          eps.forEach((e: string) => add(e, bundle))
        }
      } catch { /* ignore */ }
    }

    // Version-prefixed variants of discovered endpoints (shadow versioning).
    const base2 = [...found.keys()]
    for (const p of base2) {
      for (const vp of VERSION_PREFIXES) {
        if (!p.startsWith(vp)) add(`${vp}${p}`, 'version-prefix')
      }
    }

    const endpoints = [...found.entries()].map(([path, meta]) => {
      const relevant = RELEVANCE.some((w) => path.toLowerCase().includes(w))
      return { path, source: meta.source, relevant, inScope: isUrlInScope(`${base}${path}`).allowed }
    })
    return { ok: true, endpoints }
  },
})
