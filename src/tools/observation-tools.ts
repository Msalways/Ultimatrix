import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { CompressionService } from '../compression/headroom-service'
import { getTechniqueRegistry } from '../skills/technique-registry'

// ── WAF vendor patterns (from registry) ──

function getWafSignatures() {
  return getTechniqueRegistry().getWafSignatures().map(sig => ({
    vendor: sig.vendor,
    patterns: sig.patterns.map(p => new RegExp(p, 'i')),
  }))
}

// ── 1. parseResponse ──

export const parseResponse = createTool({
  id: 'parseResponse',
  description: 'Normalize an HTTP response: parse JSON, extract string-valued text snippets for later matching, capture body as DOM.',
  inputSchema: z.object({
    body: z.string(),
    headers: z.record(z.string(), z.string()),
    status: z.number(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      status: z.number(),
      body: z.string(),
      headers: z.record(z.string(), z.string()),
      json: z.any().nullable(),
      dom: z.string(),
      textSnippets: z.array(z.string()),
    }),
  }),
  execute: async (ctx) => {
    const compressionResult = await new CompressionService().compressResponse(ctx.body)
    let json: unknown = null
    try {
      json = JSON.parse(compressionResult.compressed)
    } catch {
      json = null
    }
    const textSnippets: string[] = []
    if (json && typeof json === 'object') {
      const walk = (obj: unknown): void => {
        if (obj === null || obj === undefined) return
        if (typeof obj === 'string') {
          textSnippets.push(obj.slice(0, 200))
          return
        }
        if (Array.isArray(obj)) {
          for (const item of obj) walk(item)
          return
        }
        if (typeof obj === 'object') {
          for (const v of Object.values(obj as Record<string, unknown>)) walk(v)
        }
      }
      walk(json)
    }
    return {
      ok: true,
      value: {
        status: ctx.status,
        body: compressionResult.compressed,
        headers: ctx.headers,
        json,
        dom: compressionResult.compressed,
        textSnippets,
      },
    }
  },
})

// ── 2. evaluateRendered ──

let _sharedBrowser: unknown = null

export function _setBrowser(b: unknown) { _sharedBrowser = b }

export const evaluateRendered = createTool({
  id: 'evaluateRendered',
  description: 'Open a URL in a Playwright browser, inject the payload into the query param, and check if it appears in the rendered DOM. Returns the rendered HTML and whether the payload was found unescaped.',
  inputSchema: z.object({
    url: z.string(),
    payload: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      rendered: z.boolean(),
      matchType: z.string(),
      body: z.string(),
    }),
  }),
  execute: async (ctx) => {
    try {
      const u = new URL(ctx.url)
      const existingParam = u.searchParams.keys().next().value
      if (existingParam) {
        u.searchParams.set(existingParam, ctx.payload)
      } else {
        u.searchParams.set('q', ctx.payload)
      }
      const targetUrl = u.toString()

      if (_sharedBrowser) {
        const browser = _sharedBrowser as { goto: (input: { url: string; waitUntil?: string; timeout?: number }) => Promise<unknown>; evaluate: (input: { script: string }) => Promise<{ success: boolean; result: unknown }> }
        try {
          await browser.goto({ url: targetUrl, waitUntil: 'load', timeout: 15000 })
          const evalResult = await browser.evaluate({ script: 'document.documentElement.outerHTML' })
          const body = evalResult?.success ? String(evalResult.result ?? '') : ''

          const lower = body.toLowerCase()
          const lowerPayload = ctx.payload.toLowerCase()
          const exact = lower.includes(lowerPayload)
          const unescaped = !lower.includes(encodeURIComponent(ctx.payload)) && exact

          let matchType = 'none'
          if (unescaped) matchType = 'unescaped'
          else if (exact) matchType = 'exact'

          return { ok: true, value: { rendered: exact, matchType, body: body.slice(0, 5000) } }
        } catch {
          // browser path failed, fall through to plain fetch
        }
      }

      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(15000) })
      const body = (await new CompressionService().compressResponse(await res.text())).compressed
      const lower = body.toLowerCase()
      const lowerPayload = ctx.payload.toLowerCase()

      const exact = lower.includes(lowerPayload)
      const unescaped = !lower.includes(encodeURIComponent(ctx.payload)) && exact

      let matchType: string = 'none'
      if (unescaped) matchType = 'unescaped'
      else if (exact) matchType = 'exact'

      return { ok: true, value: { rendered: exact, matchType, body } }
    } catch (e) {
      return { ok: false, value: { rendered: false, matchType: 'error', body: (e as Error).message } }
    }
  },
})

// ── 3. measureTiming ──

export const measureTiming = createTool({
  id: 'measureTiming',
  description: 'Time-based blind detection: run payload N iterations, compare median timing to baseline. Delta > 1500ms = likely vulnerable.',
  inputSchema: z.object({
    url: z.string(),
    baseline: z.number(),
    payload: z.string(),
    iterations: z.number().optional().default(3),
    paramName: z.string().optional(),
    method: z.string().optional().default('GET'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      timingDeltaMs: z.number(),
      vulnerable: z.boolean(),
      samples: z.array(z.number()),
    }),
  }),
  execute: async (ctx) => {
    const iters = ctx.iterations ?? 3
    const samples: number[] = []
    try {
      for (let i = 0; i < iters; i++) {
        const u = new URL(ctx.url)
        const key = ctx.paramName ?? u.searchParams.keys().next().value ?? 'q'
        u.searchParams.set(key, ctx.payload)
        const t0 = Date.now()
        await fetch(u.toString(), { method: ctx.method ?? 'GET', redirect: 'manual' })
        samples.push(Date.now() - t0)
      }
      samples.sort((a, b) => a - b)
      const median = samples[Math.floor(samples.length / 2)]
      const delta = median - ctx.baseline
      return {
        ok: true,
        value: { timingDeltaMs: delta, vulnerable: delta > 1500, samples },
      }
    } catch (e) {
      return { ok: false, value: { timingDeltaMs: 0, vulnerable: false, samples } }
    }
  },
})

// ── 4. compareResponses ──

function tryParseJsonSafe(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

function jsonBytes(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf-8')
}

function normalizeJson(obj: unknown, ignoreKeys: string[]): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map((v) => normalizeJson(v, ignoreKeys))
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (ignoreKeys.includes(k)) continue
      out[k] = normalizeJson(v, ignoreKeys)
    }
    return out
  }
  return obj
}

function jaccard(a: string, b: string): number {
  if (a === b) return 0
  const aLen = a.length
  const bLen = b.length
  if (aLen === 0 || bLen === 0) return 1
  const lenDelta = Math.abs(aLen - bLen) / Math.max(aLen, bLen)
  let sameChars = 0
  const minLen = Math.min(aLen, bLen)
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) sameChars++
  }
  const charSim = sameChars / (minLen || 1)
  return Math.min(1, lenDelta * 0.5 + (1 - charSim) * 0.5)
}

export const compareResponses = createTool({
  id: 'compareResponses',
  description: 'Compare two HTTP responses: status, body size, and normalized JSON structural divergence (0 = identical, 1 = fully different).',
  inputSchema: z.object({
    baseline: z.object({ body: z.string(), status: z.number() }),
    target: z.object({ body: z.string(), status: z.number() }),
    ignoreKeys: z.array(z.string()).optional().describe('Keys to ignore in comparison'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      divergence: z.number(),
      vulnerable: z.boolean(),
      baselineBytes: z.number(),
      targetBytes: z.number(),
    }),
  }),
  execute: async (ctx) => {
    const ignore = ctx.ignoreKeys ?? getTechniqueRegistry().getIgnoreKeys()
    const baseJson = tryParseJsonSafe(ctx.baseline.body)
    const targetJson = tryParseJsonSafe(ctx.target.body)
    let divergence: number

    if (baseJson !== null && targetJson !== null) {
      const a = normalizeJson(baseJson, ignore)
      const b = normalizeJson(targetJson, ignore)
      divergence = jaccard(JSON.stringify(a), JSON.stringify(b))
    } else {
      const aLen = ctx.baseline.body.length
      const bLen = ctx.target.body.length
      const lenDelta = Math.abs(aLen - bLen) / Math.max(aLen, bLen, 1)
      divergence = lenDelta === 0 && aLen > 0 ? 0 : Math.min(1, lenDelta)
    }

    return {
      ok: true,
      value: {
        divergence,
        vulnerable: divergence > 0.2 && ctx.baseline.status === ctx.target.status,
        baselineBytes: jsonBytes(baseJson) || ctx.baseline.body.length,
        targetBytes: jsonBytes(targetJson) || ctx.target.body.length,
      },
    }
  },
})

// ── 5. checkWaf ──

export const checkWaf = createTool({
  id: 'checkWaf',
  description: 'Inspect response headers and body for WAF fingerprints. Returns detected vendor and 0-1 confidence score.',
  inputSchema: z.object({
    responseHeaders: z.record(z.string(), z.string()),
    responseBody: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      detected: z.boolean(),
      vendor: z.string(),
      confidence: z.number(),
    }),
  }),
  execute: async (ctx) => {
    const headers = ctx.responseHeaders
    const allHeaderText = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const body = ctx.responseBody.slice(0, 4000)

    let best: { vendor: string; matches: number } = { vendor: 'unknown', matches: 0 }
    for (const sig of getWafSignatures()) {
      let matches = 0
      for (const pat of sig.patterns) {
        if (pat.test(allHeaderText) || pat.test(body)) matches++
      }
      if (matches > best.matches) {
        best = { vendor: sig.vendor, matches }
      }
    }

    return {
      ok: true,
      value: {
        detected: best.matches > 0,
        vendor: best.vendor,
        confidence: Math.min(1, best.matches * 0.4),
      },
    }
  },
})

// ── 6. findEndpointsInResponse ──

const URL_PATTERN = /https?:\/\/[^\s<>"'`()]+/g
const PATH_HREF_PATTERN = /href=["']([^"']+)["']/g
const ACTION_PATTERN = /<form[^>]+action=["']([^"']+)["']/g

export const findEndpointsInResponse = createTool({
  id: 'findEndpointsInResponse',
  description: 'Extract URLs, href targets, and form actions from HTML. Filters to same-origin only.',
  inputSchema: z.object({
    html: z.string(),
    baseUrl: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.array(z.string()),
  }),
  execute: async (ctx) => {
    const found = new Set<string>()
    const baseOrigin = new URL(ctx.baseUrl).origin

    for (const m of ctx.html.matchAll(URL_PATTERN)) {
      try {
        const u = new URL(m[0], ctx.baseUrl)
        if (u.origin === baseOrigin) found.add(u.toString())
      } catch {
        // ignore malformed
      }
    }

    for (const m of ctx.html.matchAll(PATH_HREF_PATTERN)) {
      try {
        const u = new URL(m[1], ctx.baseUrl)
        if (u.origin === baseOrigin) found.add(u.toString())
      } catch {
        // ignore
      }
    }

    for (const m of ctx.html.matchAll(ACTION_PATTERN)) {
      try {
        const u = new URL(m[1], ctx.baseUrl)
        if (u.origin === baseOrigin) found.add(u.toString())
      } catch {
        // ignore
      }
    }

    return { ok: true, value: Array.from(found) }
  },
})
