/**
 * JS miner (W0.7) — static harvest of candidate endpoints from captured JS/HTML.
 *
 * Stagehand v3 is CDP-native; we capture responses via the CDP subscriber and
 * mine the already-captured script/HTML text IN-PROCESS (no browser re-render).
 * The miner yields TYPED candidates only — never a frozen URL list in a prompt.
 * The brain/LLM inspects the candidates and decides (via the live schema) which
 * to persist as ENDPOINT nodes, always scope-guarded.
 *
 * No regex keyword hunts for "api" / "admin": we match URL-shaped tokens and
 * template literals, then let the caller reason over structure.
 */
import { isUrlInScope } from '../safety/scope-guard'

export interface JsEndpointCandidate {
  /** The URL-shaped token as found (may be relative or templated). */
  raw: string
  /** Absolute URL if it resolved against a base origin. */
  url?: string
  method?: string
  /** Source signal: fetch/xhr/axios literal, template string, or href/src attr. */
  source: 'fetch' | 'xhr' | 'axios' | 'template' | 'attr'
  /** Whether the token is in-scope per the scope guard. */
  inScope: boolean
  /** Extracted path/query params (templated `:id`-style or `?k=` style). */
  params: string[]
}

const EMPTY_OBJ: Record<string, unknown> = {}

/**
 * Mine a JS/HTML body for URL-shaped endpoint candidates.
 * @param body    raw script or html text
 * @param baseUrl origin used to absolutize relative tokens (optional)
 */
export function mineJsEndpoints(
  body: string,
  baseUrl?: string,
): JsEndpointCandidate[] {
  if (!body) return []
  const found: JsEndpointCandidate[] = []
  const seen = new Set<string>()

  const push = (raw: string, source: JsEndpointCandidate['source'], method?: string) => {
    const trimmed = raw.trim()
    if (!trimmed || seen.has(trimmed)) return
    // URL-shaped only: must contain '/' and a non-whitespace path, or be http(s).
    if (!/^https?:\/\//.test(trimmed) && !trimmed.includes('/')) return
    seen.add(trimmed)
    let url: string | undefined
    try {
      if (baseUrl && !/^https?:\/\//.test(trimmed)) {
        url = new URL(trimmed, baseUrl).toString()
      } else if (/^https?:\/\//.test(trimmed)) {
        url = trimmed
      }
    } catch {
      url = undefined
    }
    const params = extractParams(trimmed)
    const inScope = url ? isUrlInScope(url).allowed : false
    found.push({ raw: trimmed, url, method, source, inScope, params })
  }

  // fetch('...'), fetch(`...`), axios.get('...'), axios.post("...")
  const callRe =
    /(?:(?:fetch|axios(?:\.(?:get|post|put|delete|patch))?)\s*\(\s*`([^`]+)`|(?:fetch|axios(?:\.(?:get|post|put|delete|patch))?)\s*\(\s*["']([^"']+)["'])/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(body))) {
    const token = m[1] ?? m[2] ?? ''
    const method = /axios\.(post|put|patch|delete)/.test(m[0])
      ? (m[0].match(/axios\.(post|put|patch|delete)/)?.[1]?.toUpperCase())
      : undefined
    push(token, 'fetch', method)
  }

  // new XMLHttpRequest(); .open('GET', '...')
  const xhrRe = /\.open\s*\(\s*["']?(GET|POST|PUT|DELETE|PATCH)["']?\s*,\s*["'`]([^"'`]+)["'`]/gi
  while ((m = xhrRe.exec(body))) {
    push(m[2], 'xhr', m[1].toUpperCase())
  }

  // window.location / href / src attributes pointing at a path
  const attrRe = /\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi
  while ((m = attrRe.exec(body))) {
    push(m[1], 'attr')
  }

  // Bare template-literal URL shapes: `https://...${...}` or `/api/.../${...}`
  const tmplRe = /[`"']((?:https?:\/\/|\/)[^`'"]*\$\{[^`'"]+)[`'"]/g
  while ((m = tmplRe.exec(body))) {
    push(m[1], 'template')
  }

  return found
}

function extractParams(token: string): string[] {
  const params: string[] = []
  const tmpl = token.match(/\$\{\s*([\w.]+)\s*\}/g)
  if (tmpl) params.push(...tmpl.map((t) => t.replace(/[${}]/g, '').trim()))
  const query = token.match(/[?&]([\w.-]+)=/g)
  if (query) params.push(...query.map((q) => q.replace(/[?&]=/, '')))
  return Array.from(new Set(params))
}

/** Convenience: mine a list of bodies and dedupe by url. */
export function mineJsBodies(
  bodies: Array<{ body: string; baseUrl?: string }>,
): JsEndpointCandidate[] {
  const all: JsEndpointCandidate[] = []
  const seen = new Set<string>()
  for (const { body, baseUrl } of bodies) {
    for (const c of mineJsEndpoints(body, baseUrl)) {
      const key = c.url ?? c.raw
      if (seen.has(key)) continue
      seen.add(key)
      all.push(c)
    }
  }
  return all
}

void EMPTY_OBJ
