/**
 * Post-crawl discovery (Phase C, spec 03 tasks C4/C5).
 *
 * Runs once at crawl completion, over what the session ALREADY captured:
 * - shadowApiDiscovery: OpenAPI/doc seeds + JS-bundle + version-prefix probing
 *   (routed through httpRequest → scope guard, robots, rate limit, evidence).
 * - js-miner: static harvest of URL-shaped endpoint candidates from captured
 *   script/HTML response bodies (passive analysis of delivered content —
 *   nothing new is requested).
 *
 * Mined candidates land as Endpoint nodes tagged 'js-mined'; shadow probes as
 * 'shadow-api'. Both are passive observations for the brain to reason over,
 * never auto-executed attack traffic.
 */

import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import { getCapturedRequestStore } from '../capture/captured-request-store'
import { mineJsEndpoints } from '../capture/js-miner'
import { shadowApiDiscovery } from '../tools/shadow-discovery'

export interface PostCrawlDiscoveryResult {
  shadowEndpoints: number
  jsCandidates: number
  errors: string[]
}

/** Response bodies worth mining: scripts and HTML documents. */
function isMineableContentType(contentType?: string): boolean {
  if (!contentType) return false
  const ct = contentType.toLowerCase()
  return (
    ct.includes('javascript') ||
    ct.includes('ecmascript') ||
    ct.includes('text/html') ||
    ct.includes('application/json')
  )
}

const MAX_JS_CANDIDATES = 50

export async function runPostCrawlDiscovery(target: string): Promise<PostCrawlDiscoveryResult> {
  const result: PostCrawlDiscoveryResult = { shadowEndpoints: 0, jsCandidates: 0, errors: [] }
  const store = getGlobalGraphStore()

  // 1. Shadow API probing (active but scope-guarded via httpRequest).
  try {
    const exec = shadowApiDiscovery.execute
    if (typeof exec !== 'function') throw new Error('shadowApiDiscovery is not executable')
    const shadow = (await (exec as (input: unknown, ctx?: unknown) => Promise<unknown>).call(
      shadowApiDiscovery,
      { baseUrl: target },
    )) as {
      ok: boolean
      endpoints?: Array<{ path: string; source: string; relevant: boolean; inScope: boolean }>
    }
    if (shadow?.ok && Array.isArray(shadow.endpoints)) {
      for (const ep of shadow.endpoints) {
        if (!ep.inScope) continue
        try {
          store.addEndpoint({
            url: `${target.replace(/\/$/, '')}${ep.path}`,
            method: 'GET',
            params: [],
            tags: ['shadow-api', `source:${ep.source}`],
            source: 'post-crawl-discovery',
          })
          result.shadowEndpoints++
        } catch {
          /* individual merge failure is non-fatal */
        }
      }
    }
  } catch (err) {
    result.errors.push(`shadow: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. JS/HTML body mining over captured traffic (passive).
  try {
    const captureStore = getCapturedRequestStore()
    const existing = new Set(
      (store.queryNodes?.(NodeType.ENDPOINT) ?? []).map(
        (n) => `${String((n.properties as any).method ?? 'GET').toUpperCase()}:${String((n.properties as any).url ?? '')}`,
      ),
    )

    let added = 0
    for (const ref of captureStore.list()) {
      if (added >= MAX_JS_CANDIDATES) break
      const entry = captureStore.get(ref.id)
      const contentType =
        Object.entries(entry?.responseHeaders ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      if (!isMineableContentType(contentType)) continue
      const body = entry?.responseBody
      if (!body) continue

      for (const candidate of mineJsEndpoints(body, entry!.url)) {
        if (added >= MAX_JS_CANDIDATES) break
        if (!candidate.url || !candidate.inScope) continue
        const key = `${(candidate.method ?? 'GET').toUpperCase()}:${candidate.url}`
        if (existing.has(key)) continue
        try {
          store.addEndpoint({
            url: candidate.url,
            method: candidate.method ?? 'GET',
            params: candidate.params.map((name) => ({ name, type: 'string', in: 'query' })),
            tags: ['js-mined', `signal:${candidate.source}`],
            source: 'post-crawl-discovery',
          })
          existing.add(key)
          added++
        } catch {
          /* non-fatal */
        }
      }
    }
    result.jsCandidates = added
  } catch (err) {
    result.errors.push(`js-miner: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}
