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
  /**
   * The exact page to capture. Pass it when the caller already has one.
   *
   * Capturing "whatever page is active when the capture starts" is a race: the
   * observer provisions its own page and then navigates THAT, so the
   * subscription lands on a different target and records nothing. Verified live
   * 2026-09-29 on OWASP Juice Shop — CDP attached, Network.enable accepted, zero
   * requests, precisely because the two pages differed.
   */
  page?: any
}

export interface CdpCaptureHandle {
  attached: boolean
  /** Resolves after the CDP Network domain is enabled. */
  ready?: Promise<void>
  /** Drain completed entries without detaching the capture subscriber. */
  flush: () => Promise<HarEntry[]>
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
  //
  // `activePage()` is ASYNC. This call site used to read it synchronously, so
  // `page` was an unresolved Promise, `page.mainSession` was undefined, and the
  // `??` silently selected the root connection every single time — the one the
  // comment above says observes zero requests. Capture then reported
  // attached:true, resolved ready, and recorded nothing at all, which surfaced
  // as "Baseline observation captured zero network requests".
  // Verified live 2026-09-29 on OWASP Juice Shop. Same class of defect as the
  // page resolver in browser/manager.ts: a thenable passed off as a real object.
  const pagePromise: Promise<any> | null =
    opts.page != null
      ? Promise.resolve(opts.page)
      : typeof (stagehand as any)?.context?.activePage === 'function'
        ? Promise.resolve((stagehand as any).context.activePage())
        : null

  const noop: CdpCaptureHandle = {
    attached: false,
    ready: Promise.resolve(),
    flush: async () => [],
    stop: async () => [],
    entries: () => [],
    requestCount: () => 0,
  }

  // Resolved asynchronously, and every subscription below is registered once it
  // lands. `ready` rejects when no usable connection exists, which the caller
  // already handles by falling back — so the sync signature and its
  // attached/ready contract are unchanged.
  let conn: any = null
  let connResolved = false
  const resolveConn = async (): Promise<any> => {
    if (connResolved) return conn
    connResolved = true
    const page = pagePromise ? await pagePromise : undefined
    conn = page?.mainSession ?? (stagehand as any)?.context?.conn
    if (!conn || typeof conn.on !== 'function' || typeof conn.send !== 'function') {
      throw new Error('No usable CDP connection for HAR capture')
    }
    if (process.env.ULTIMATRIX_BROWSER_TRACE) {
      const pageAny: any = page
      console.log('[bt-cap-resolve] ' + JSON.stringify({
        pageCtor: pageAny?.constructor?.name,
        pageIsPromise: typeof pageAny?.then === 'function',
        pageKeys: pageAny ? Object.getOwnPropertyNames(Object.getPrototypeOf(pageAny)).slice(0, 14) : null,
        hasMainSession: !!pageAny?.mainSession,
        usedRootConn: !pageAny?.mainSession,
        connCtor: conn?.constructor?.name,
      }))
    }
    return conn
  }

  const builder: HarEntryBuilder = createHarEntryBuilder()
  const maxBody = opts.maxResponseBodySize ?? DEFAULT_MAX_BODY
  const captureResponseBody = opts.captureResponseBody !== false
  const captureRequestBody = opts.captureRequestBody === true
  let observed = 0
  const cleanup: Array<() => void> = []

  const on = (event: string, handler: (params: any) => void) => {
    if (!conn) throw new Error('CDP capture subscribed before the connection resolved')
    conn.on(event, handler)
    cleanup.push(() => {
      if (typeof conn?.off === 'function') conn.off(event, handler)
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

  // Every Network.* subscription is registered in one place, called only once
  // the target session has actually resolved. Registering eagerly against a
  // not-yet-known connection is what made this look attached while seeing
  // nothing.
  const register = () => {
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
  }

  // The caller must await this before navigation; otherwise the document
  // request can race the subscription and produce an empty HAR.
  // Resolving the connection is part of `ready`, not a separate step: the
  // target session is only obtainable asynchronously, and subscribing before
  // it lands is the defect this fixes.
  const ready = (async () => {
    const c = await resolveConn()
    register()
    await c.send('Network.enable', {})
  })()

  return {
    attached: true,
    ready,
    entries: () => builder.entries(),
    requestCount: () => observed,
    flush: async () => {
      await Promise.allSettled([...pendingBodies])
      return builder.takeCompleted()
    },
    stop: async () => {
      for (const fn of cleanup) fn()
      cleanup.length = 0
      // Await any in-flight body/post-data fetches so entries are complete.
      await Promise.allSettled([...pendingBodies])
      try {
        await conn?.send('Network.disable', {})
      } catch {
        /* ignore */
      }
      return builder.takeCompleted()
    },
  }
}
