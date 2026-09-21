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

function ingestApiSchema(store: ReturnType<typeof getGlobalGraphStore>, body: string, documentUrl: string): number {
  let document: any
  try { document = JSON.parse(body) } catch { return 0 }
  if (!document || typeof document !== 'object' || !document.paths || typeof document.paths !== 'object') return 0
  let added = 0
  let origin: URL
  try { origin = new URL(documentUrl) } catch { return 0 }
  for (const [path, item] of Object.entries(document.paths as Record<string, any>)) {
    if (!path.startsWith('/') || !item || typeof item !== 'object') continue
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
      const operation = item[method]
      if (!operation || typeof operation !== 'object') continue
      let url: string
      try { url = new URL(path, origin).toString() } catch { continue }
      const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        .filter((parameter: any) => parameter?.name)
        .map((parameter: any) => ({ name: String(parameter.name), type: String(parameter.schema?.type ?? parameter.type ?? 'string'), in: String(parameter.in ?? 'query') }))
      const bodySchema = operation.requestBody?.content
        ? Object.values(operation.requestBody.content as Record<string, any>)[0]?.schema
        : undefined
      store.mergeEndpoint({
        url,
        method: method.toUpperCase(),
        params: parameters,
        ...(bodySchema ? { bodySchema } : {}),
        ...(operation.summary || operation.description ? { description: String(operation.summary ?? operation.description) } : {}),
        tags: ['openapi', ...(Array.isArray(operation.tags) ? operation.tags.map(String) : [])],
        source: 'api-schema-discovery',
        authRequired: Array.isArray(operation.security) ? operation.security.length > 0 : Array.isArray(document.security) ? document.security.length > 0 : undefined,
      })
      added++
    }
  }
  return added
}

const MAX_JS_CANDIDATES = 50

function looksLikeApiSchemaUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return /(?:^|\/)(?:openapi|swagger)(?:\.json)?$/.test(path)
  } catch { return false }
}

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
    const runtimeObserved = new Set(
      (store.queryNodes?.(NodeType.ENDPOINT) ?? []).map(
        (n) => `${String((n.properties as any).method ?? 'GET').toUpperCase()}:${String((n.properties as any).url ?? '')}`,
      ),
    )
    const processed = new Set<string>()

    let added = 0
    for (const ref of captureStore.list()) {
      if (added >= MAX_JS_CANDIDATES) break
      const entry = captureStore.get(ref.id)
      const contentType =
        Object.entries(entry?.responseHeaders ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      const body = entry?.responseBody
      if (!body) continue

      const schemaAdded = ingestApiSchema(store, body, entry!.url)
      if (schemaAdded > 0) result.shadowEndpoints += schemaAdded
      if (!isMineableContentType(contentType) && !looksLikeApiSchemaUrl(entry!.url)) continue

      for (const candidate of mineJsEndpoints(body, entry!.url)) {
        if (added >= MAX_JS_CANDIDATES) break
        if (!candidate.url || !candidate.inScope) continue
        const key = `${(candidate.method ?? 'GET').toUpperCase()}:${candidate.url}`
        if (processed.has(key)) continue
        processed.add(key)
        // Keep static analysis as provenance, but mark it as correlated when
        // the same route was observed at runtime.  This lets the research
        // layer use the JS client as workflow context without promoting a
        // bundle-only string into active attack traffic.
        const correlated = runtimeObserved.has(key)
        try {
          store.mergeEndpoint({
            url: candidate.url,
            method: candidate.method ?? 'GET',
            params: candidate.params.map((name) => ({ name, type: 'string', in: 'query' })),
            tags: [
              'js-mined',
              ...(correlated ? ['js-correlated'] : []),
              `signal:${candidate.source}`,
            ],
            source: 'post-crawl-discovery',
          })
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

  // Shadow and JS-mined endpoints are graph state, not transient diagnostics.
  // Persist them before returning so the following research-map pass can
  // select and execute against the discovered application surface.
  try {
    await store.save()
  } catch (err) {
    result.errors.push(`graph-save: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}
