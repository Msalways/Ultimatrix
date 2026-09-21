import type { Stagehand } from '@browserbasehq/stagehand'
import {
  createHarEntryBuilder,
  type HarEntry,
  type HarEntryBuilder,
} from '../capture/har-parser'
import { recordRenderTraceFromResponse } from '../capture/render-bridge'

export interface CdpCaptureOptions {
  maxResponseBodySize?: number
  captureRequestBody?: boolean
  captureResponseBody?: boolean
}

export interface CdpCaptureHandle {
  attached: boolean
  /** Resolves after the CDP Network domain is enabled. */
  ready?: Promise<void>
  /** Stop capturing and return any completed HAR entries collected so far. */
  stop: () => Promise<HarEntry[]>
  /** Completed entries collected so far without stopping. */
  entries: () => HarEntry[]
  /** Number of requests observed. */
  requestCount: () => number
}

const DEFAULT_MAX_BODY = 1024 * 1024 // 1MB

/**
 * Attach a HAR capture to the live Stagehand CDP connection. This module is a
 * THIN SUBSCRIBER only: it listens to the full `Network.*` event set (including
 * the `ExtraInfo` events that carry cookies/headers split across two CDP
 * events) and forwards raw params to the single HAR-entry builder owned by
 * `har-parser.ts`. No HAR-assembly logic lives here.
 *
 * Stagehand v3 is CDP-native. Playwright `recordHar`/`page.route` are not
 * available on its internal Page wrapper, so CDP `Network.*` is the native
 * capture surface; it must be attached to the active page target session.
 */
export function attachHarCaptureViaCdp(
  stagehand: Stagehand,
  opts: CdpCaptureOptions = {},
): CdpCaptureHandle {
  // Stagehand v3 multiplexes browser-level and target-level CDP traffic.
  // Network.* events are emitted by the active page's target session, not by
  // the root context connection. Subscribing to context.conn therefore looks
  // attached but observes zero requests (or rejects Network.enable). Keep the
  // root connection only as a compatibility fallback for older Stagehand.
  const page: any = (stagehand as any)?.context?.activePage?.()
  const conn: any = page?.mainSession ?? (stagehand as any)?.context?.conn
  const noop: CdpCaptureHandle = {
    attached: false,
    ready: Promise.resolve(),
    stop: async () => [],
    entries: () => [],
    requestCount: () => 0,
  }
  if (!conn || typeof conn.on !== 'function' || typeof conn.send !== 'function') {
    return noop
  }

  const builder: HarEntryBuilder = createHarEntryBuilder()
  const maxBody = opts.maxResponseBodySize ?? DEFAULT_MAX_BODY
  const captureResponseBody = opts.captureResponseBody !== false
  const captureRequestBody = opts.captureRequestBody === true
  let observed = 0
  const cleanup: Array<() => void> = []

  const on = (event: string, handler: (params: any) => void) => {
    conn.on(event, handler)
    cleanup.push(() => {
      if (typeof conn.off === 'function') conn.off(event, handler)
    })
  }

  const pendingBodies = new Set<Promise<unknown>>()

  const fetchBody = (requestId: string, meta: { url: string; method: string; status: number; contentType?: string }) => {
    if (!captureResponseBody) return
    const p = conn
      .send('Network.getResponseBody', { requestId })
      .then((res: any) => {
        if (res?.body == null) return
        const body = String(res.body)
        // C7 — oversize bodies are stored truncated WITH a structural marker
        // (mirrors the CompressionResult contract); silent drops made
        // "body withheld" indistinguishable from "no body".
        if (body.length > maxBody) {
          builder.setResponseBody(requestId, body.slice(0, maxBody), res.base64Encoded ? 'base64' : undefined, true)
          return
        }
        builder.setResponseBody(requestId, body, res.base64Encoded ? 'base64' : undefined)
        if (!res.base64Encoded) {
          try {
            recordRenderTraceFromResponse({
              url: meta.url,
              method: meta.method,
              status: meta.status,
              contentType: meta.contentType,
              body,
            })
          } catch {
            /* render tracing is best-effort */
          }
        }
      })
      .catch(() => {})
    pendingBodies.add(p)
    p.finally(() => pendingBodies.delete(p))
  }

  // C7 — per-request method tracked from requestWillBeSent so responseMeta
  // no longer hardcodes GET (render tracing keyed on real method).
  const requestMethods = new Map<string, string>()
  const responseMeta = new Map<string, { url: string; method: string; status: number; contentType?: string }>()

  on('Network.requestWillBeSent', (p: any) => {
    observed++
    if (p?.request?.method) requestMethods.set(p.requestId, p.request.method)
    builder.onRequestWillBeSent(p)
  })
  on('Network.requestWillBeSentExtraInfo', (p: any) => builder.onRequestWillBeSentExtraInfo(p))
  on('Network.responseReceived', (p: any) => {
    builder.onResponseReceived(p)
    responseMeta.set(p.requestId, {
      url: p?.response?.url ?? '',
      method: requestMethods.get(p.requestId) ?? 'GET',
      status: p?.response?.status ?? 0,
      contentType: p?.response?.mimeType,
    })
  })
  on('Network.responseReceivedExtraInfo', (p: any) => builder.onResponseReceivedExtraInfo(p))
  on('Network.loadingFinished', (p: any) => {
    builder.onLoadingFinished(p)
    const meta = responseMeta.get(p.requestId)
    if (meta) fetchBody(p.requestId, meta)
    responseMeta.delete(p.requestId)
    requestMethods.delete(p.requestId)
    // POST body (if enabled) — separate CDP call
    if (captureRequestBody) {
      const pb = conn
        .send('Network.getRequestPostData', { requestId: p.requestId })
        .then((r: any) => {
          if (r?.postData != null) builder.setRequestBody(p.requestId, r.postData)
        })
        .catch(() => {})
      pendingBodies.add(pb)
      pb.finally(() => pendingBodies.delete(pb))
    }
  })
  on('Network.loadingFailed', (p: any) => builder.onLoadingFailed(p))

  // The caller must await this before navigation; otherwise the document
  // request can race the subscription and produce an empty HAR.
  const ready = conn.send('Network.enable', {}).then(() => undefined)

  return {
    attached: true,
    ready,
    entries: () => builder.entries(),
    requestCount: () => observed,
    stop: async () => {
      for (const fn of cleanup) fn()
      cleanup.length = 0
      // Await any in-flight body/post-data fetches so entries are complete.
      await Promise.allSettled([...pendingBodies])
      try {
        await conn.send('Network.disable', {})
      } catch {
        /* ignore */
      }
      return builder.takeCompleted()
    },
  }
}
