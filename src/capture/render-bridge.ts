/**
 * Render bridge (WS-E + capture wiring) — turns live HTTP/spider responses into
 * RENDERED_ELEMENT graph nodes + a forensic event, so the graph reflects what
 * actually renders (form fields, handlers) and where sent payloads land.
 *
 * Called from NetworkCapture on every HTML response and from any live response
 * path. Deduplicates by (url, selector) to avoid graph bloat across many
 * navigations of the same page.
 */
import { getGlobalGraphStore } from '../graph/store'
import { getForensicLog } from '../tools/report-tools'
import { isHtmlBody, traceRender, type RenderTrace } from './render-tracer'
import { NodeType, type EndpointNode, type RenderedElementNode } from '../graph/schema'
import { normalizedEndpointKey } from '../graph/relations'

export interface RenderCaptureInput {
  url: string
  method?: string
  status?: number
  contentType?: string
  body?: string
}

export function recordRenderTraceFromResponse(input: RenderCaptureInput): RenderTrace | null {
  const ct = (input.contentType ?? '').toLowerCase()
  const htmlish = ct.includes('text/html') || (input.body ? isHtmlBody(input.body) : false)
  if (!htmlish || !input.body) return null

  const trace = traceRender(input.body)
  if (!trace.html) return null

  const store = getGlobalGraphStore()
  const forensic = getForensicLog()

  let endpointId: string | undefined
  let existing: RenderedElementNode[] = []
  if (store) {
    const key = normalizedEndpointKey(input.method ?? 'GET', input.url)
    endpointId = ((store.queryNodes(NodeType.ENDPOINT) as EndpointNode[] | undefined) ?? []).find(
      (e) => normalizedEndpointKey(e.properties.method, e.properties.url) === key,
    )?.id
    existing = (store.queryNodes(NodeType.RENDERED_ELEMENT) as RenderedElementNode[] | undefined) ?? []
  }

  let nodes = 0
  if (store) {
    for (const f of trace.formFields) {
      const dup = existing.some((n) => n.properties.url === input.url && n.properties.selector === f.selector)
      if (dup) continue
      store.addRenderedElement(endpointId, {
        url: input.url,
        method: input.method,
        selector: f.selector,
        tag: f.tag,
        name: f.name,
        inputType: f.type,
        value: f.value,
        isFormField: true,
        attributes: f.attributes,
        text: f.text,
        payloadHit: trace.payloadHits.length > 0,
      })
      nodes++
    }
  }

  forensic?.log({
    type: 'render-trace',
    url: input.url,
    method: input.method,
    status: input.status,
    formFields: trace.formFields.length,
    inlineHandlers: trace.inlineHandlers.length,
    payloadHits: trace.payloadHits.length,
    nodes,
  })

  return trace
}

/**
 * Wire a live Playwright/Stagehand page so every HTML response is render-traced
 * into RENDERED_ELEMENT graph nodes — including pages the spider crawls (which
 * otherwise never pass through NetworkCapture). Idempotent per page object.
 *
 * Lightweight by design: no HAR accumulation, just the same best-effort
 * trace that NetworkCapture performs for the capture browser. Skips
 * non-HTML responses before reading the body to avoid needless I/O.
 */
const renderWiredPages = new WeakSet<object>()

export function wireRenderTrace(page: any): void {
  if (!page || typeof page.on !== 'function') return
  if (renderWiredPages.has(page)) return
  renderWiredPages.add(page)

  page.on('response', (response: any) => {
    const run = async () => {
      try {
        const ct = (response.headers?.()?.['content-type'] ?? '').toLowerCase()
        if (ct && !ct.includes('text/html')) return
        const body = await response.body?.().catch(() => null)
        if (!body) return
        const text = body.toString('utf-8')
        if (!text) return
        recordRenderTraceFromResponse({
          url: response.request?.()?.url?.(),
          method: response.request?.()?.method?.(),
          status: response.status?.(),
          contentType: ct || undefined,
          body: text,
        })
      } catch {
        /* best-effort render tracing */
      }
    }
    run()
  })
}
