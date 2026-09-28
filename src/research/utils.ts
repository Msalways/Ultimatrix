import { createHash } from 'node:crypto'

export function stableId(prefix: string, parts: Array<string | number | undefined>): string {
  const raw = parts.filter(p => p !== undefined && p !== '').join(':')
  const hash = createHash('sha256').update(raw || prefix).digest('hex').slice(0, 12)
  return `${prefix}:${hash}`
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function words(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function inferNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const meaningful = [...segments].reverse().find((s: string) => !/^\d+$/.test(s) && !/^[0-9a-f-]{8,}$/i.test(s))
    return meaningful || parsed.hostname
  } catch {
    const segments = url.split('/').filter(Boolean)
    return [...segments].reverse().find((s: string) => !/^\d+$/.test(s)) || url
  }
}

export function normalizeName(input: string): string {
  return input
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

export function looksLikeId(value: string): boolean {
  return /^\d+$/.test(value) || /^[0-9a-f]{8,}$/i.test(value) || /^[0-9a-f-]{16,}$/i.test(value)
}

const STATIC_ASSET_EXTENSIONS = ['js', 'mjs', 'css', 'map', 'png', 'jpe?g', 'gif', 'svg', 'ico', 'woff2?', 'ttf', 'eot', 'webp', 'pdf', 'zip']
const STATIC_ASSET_PATH_RE = new RegExp(`\\.(?:${STATIC_ASSET_EXTENSIONS.join('|')})$`, 'i')
const TRANSPORT_POLLING_RE = /(?:^|\/)(?:socket\.io|sockjs)(?:\/|$)/
const METADATA_LAST_SEGMENT_RE = /(?:^|[-_])(?:health|healthz|ready|readiness|liveness|version|configuration|config|docs?|swagger|openapi|status)$/

/**
 * Transport, static-asset, and metadata URLs carry no application behavior:
 * socket polling, bundles, fonts, images, favicons, health/version/config
 * documents. Modeling them as workflows/entities (or hypotheses) turns
 * infrastructure noise into phantom behavior ("favicon.ico may be
 * bypassable"). Single shared gate so extraction and hypothesis rules
 * cannot drift apart; shape-based, target-agnostic.
 */
export function isTransportOrAssetUrl(url: string, method?: string): boolean {
  let pathname: string
  try {
    pathname = new URL(url).pathname.toLowerCase()
  } catch {
    return false
  }
  if (TRANSPORT_POLLING_RE.test(pathname)) return true
  if (STATIC_ASSET_PATH_RE.test(pathname)) return true
  if (String(method ?? 'GET').toUpperCase() !== 'GET') return false
  const last = pathname.split('/').filter(Boolean).pop() ?? ''
  return METADATA_LAST_SEGMENT_RE.test(last)
}

/**
 * Minimum echoed-value length that counts as a reflection signal. Short
 * tokens (`1`, `en`, `q`) collide with ordinary page text by chance; a
 * 6+ character verbatim echo of a request-supplied value is structural
 * evidence of reflection, not vocabulary matching.
 */
export const MIN_REFLECTION_VALUE_LENGTH = 6

/**
 * Deterministic challenge marker for reflection probes, stable per
 * endpoint + parameter so initial and repeated executions compare the same
 * challenge. Distinct (endpoint, param) pairs get distinct markers, keeping
 * concurrent experiments independent. Retest freshness (a *different*
 * marker) remains the researcher's job — the retest oracle rejects reuse.
 */
export function reflectionMarker(url: string, param: string): string {
  return stableId('marker', [url, param]).replace('marker:', 'marker-')
}

/**
 * Build a marker-URL mutation for a captured request URL: every listed
 * query parameter present in the URL gets its own deterministic marker URL
 * (reserved example.com host — routable nowhere, never fetched since the
 * HTTP path uses redirect:'manual'). Returns the mutated URL, the per-param
 * marker URLs, and the parameters actually rewritten. Mirrors
 * reflectionMutation for redirect-destination sinks.
 */
export function redirectMutation(
  requestUrl: string,
  params: string[],
): { url?: string; markers: Record<string, string>; rewritten: string[] } {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return { url: undefined, markers: {}, rewritten: [] }
  }
  const present = params.filter(name => parsed.searchParams.has(name))
  const targets = present.length > 0 ? present : [...parsed.searchParams.keys()]
  if (targets.length === 0) return { url: undefined, markers: {}, rewritten: [] }
  const markers: Record<string, string> = {}
  for (const name of targets) {
    const marker = redirectMarkerUrl(requestUrl, name)
    markers[name] = marker
    parsed.searchParams.set(name, marker)
  }
  return { url: parsed.toString(), markers, rewritten: targets }
}

/**
 * Deterministic marker URL for redirect-destination probes, stable per
 * endpoint + parameter. Lives on the reserved example.com host so it can
 * never resolve to a real origin; the replay path never follows redirects,
 * so no request ever leaves the engagement target.
 */
export function redirectMarkerUrl(url: string, param: string): string {
  return `https://marker-${stableId('marker', [url, param]).replace('marker:', '')}.example.com/`
}

/**
 * Build a marker-injection mutation for a captured request URL: every
 * listed query parameter present in the URL gets its own deterministic
 * reflection marker as its value. Returns the mutated URL, the per-param
 * markers, and the parameters actually rewritten (empty when nothing
 * matched). Markers derive from the ORIGINAL request URL so the mutation
 * builder and the differential asserter independently derive identical
 * values without sharing state.
 */
export function reflectionMutation(
  requestUrl: string,
  params: string[],
): { url?: string; markers: Record<string, string>; rewritten: string[] } {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return { url: undefined, markers: {}, rewritten: [] }
  }
  const present = params.filter(name => parsed.searchParams.has(name))
  const targets = present.length > 0 ? present : [...parsed.searchParams.keys()]
  if (targets.length === 0) return { url: undefined, markers: {}, rewritten: [] }
  const markers: Record<string, string> = {}
  for (const name of targets) {
    const marker = reflectionMarker(requestUrl, name)
    markers[name] = marker
    parsed.searchParams.set(name, marker)
  }
  return { url: parsed.toString(), markers, rewritten: targets }
}
