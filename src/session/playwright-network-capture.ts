/**
 * attachHarCaptureViaPlaywright — Phase A (spec 02 A4).
 *
 * The Firefox-native capture surface: Playwright context request/response
 * events + response.body(), feeding the SAME single HAR-entry builder owned by
 * har-parser.ts. This is the platform-native mechanism under a non-Chromium
 * provider — explicitly NOT a hand-sliced protocol subset (CDP Network.* does
 * not exist under Firefox; ExtraInfo-equivalent header detail is a documented
 * platform limitation).
 *
 * Thin subscriber only — no HAR-assembly logic lives here.
 */

import type { BrowserContext } from 'playwright'
import {
  createHarEntryBuilder,
  type HarEntry,
} from '../capture/har-parser'

export interface PlaywrightCaptureHandle {
  attached: boolean
  /** Stop capturing and return any completed HAR entries collected so far. */
  stop: () => Promise<HarEntry[]>
  /** Completed entries collected so far without stopping. */
  entries: () => HarEntry[]
  requestCount: () => number
}

const DEFAULT_MAX_BODY = 1024 * 1024 // 1MB

interface RequestRecord {
  url: string
  method: string
  headers?: Record<string, string>
  postData?: string
}

export function attachHarCaptureViaPlaywright(
  context: BrowserContext,
  opts: { maxResponseBodySize?: number; captureResponseBody?: boolean } = {},
): PlaywrightCaptureHandle {
  const builder = createHarEntryBuilder()
  const maxBody = opts.maxResponseBodySize ?? DEFAULT_MAX_BODY
  const captureResponseBody = opts.captureResponseBody !== false

  let observed = 0
  const inflight: Array<Promise<unknown>> = []
  const requests = new Map<string, RequestRecord>()

  const track = (p: Promise<unknown>) => {
    inflight.push(p)
    p.finally(() => {
      const i = inflight.indexOf(p)
      if (i >= 0) inflight.splice(i, 1)
    })
  }

  const onResponse = async (response: import('playwright').Response) => {
    builder.onPlaywrightResponse({
      url: response.url(),
      status: response.status(),
      headers: response.headers(),
      requestHeaders: response.request().headers(),
      method: response.request().method(),
      postData: response.request().postData() ?? undefined,
    })
    if (!captureResponseBody) return
    track((async () => {
      try {
        let body = await response.text()
        let truncated = false
        if (body.length > maxBody) {
          body = body.slice(0, maxBody)
          truncated = true
        }
        builder.setPlaywrightResponseBody(response.url(), response.status(), body, truncated)
      } catch {
        /* body unavailable (streamed/binary/auth) — entry stands without text */
      }
    })())
  }

  const onRequestFailed = (request: import('playwright').Request) => {
    builder.onPlaywrightRequestFailed(request.url(), request.method())
  }

  context.on('response', (response) => {
    observed++
    void onResponse(response as unknown as import('playwright').Response)
  })
  context.on('requestfailed', onRequestFailed)

  return {
    attached: true,
    entries: () => builder.entries(),
    requestCount: () => observed,
    stop: async () => {
      void requests
      await Promise.allSettled([...inflight])
      try {
        await context.close()
      } catch {
        /* context may already be closing */
      }
      return builder.takeCompleted()
    },
  }
}
