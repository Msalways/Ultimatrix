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
import { isHtmlBody, safeFormAttributes, traceRender, type RenderTrace } from './render-tracer'
import { NodeType, type EndpointNode, type RenderedElementNode } from '../graph/schema'
import { normalizedEndpointKey } from '../graph/relations'

export interface RenderCaptureInput {
  url: string
  method?: string
  status?: number
  contentType?: string
  body?: string
}

function sameOriginPath(raw: string | undefined, baseUrl: string): string | undefined {
  try {
    const base = new URL(baseUrl)
    const url = new URL(raw || base.pathname, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin) return undefined
    return `${url.origin}${url.pathname}`
  } catch {
    return undefined
  }
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
    const sourceUrl = sameOriginPath(undefined, input.url) ?? input.url
    for (const f of trace.formFields) {
      const dup = existing.some((n) => n.properties.url === sourceUrl && n.properties.selector === f.selector)
      if (dup) continue
      const attributes = safeFormAttributes(f.attributes)
      store.addRenderedElement(endpointId, {
        url: sourceUrl,
        method: input.method,
        selector: f.selector,
        tag: f.tag,
        name: f.name,
        inputType: f.type,
        isFormField: true,
        attributes,
        // A textarea's content is represented as text in HTML. Keep form
        // structure only; the current/default value is never target-map data.
        payloadHit: trace.payloadHits.length > 0,
      })
      nodes++
    }

    // Keep same-origin page actions in the graph and remove query values so
    // signed links and user data do not become target-map context.
    if (sourceUrl) {
      const seen = new Set(existing.filter((node) => node.properties.url === sourceUrl).map((node) => node.properties.selector))
      for (const element of trace.elements.filter(isPageInteraction)) {
        const attrs = element.attributes
        const tag = element.tag
        const isLink = tag === 'a' || String(attrs.role ?? '').toLowerCase() === 'link'
        const isForm = tag === 'form'
        const rawDestination = isLink
          ? attrs.href || attrs.routerlink || attrs.routerLink || attrs['data-route'] || attrs['data-href']
          : isForm ? attrs.action : undefined
        const destination = (rawDestination || isForm) ? sameOriginPath(rawDestination, input.url) : undefined
        if ((isLink || isForm) && rawDestination && !destination) continue
        const path = destination ? new URL(destination).pathname : undefined
        const method = isForm ? (attrs.method || 'GET').toUpperCase() : undefined
        const inputAction = tag === 'input' && ['button', 'submit'].includes(String(attrs.type ?? '').toLowerCase())
        const label = (element.text || attrs['aria-label'] || attrs.title || attrs.name || (inputAction ? attrs.value : '') || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        const selector = inputAction && attrs.value
          ? `input[type=${JSON.stringify(attrs.type)}][value=${JSON.stringify(attrs.value)}]`
          : path
          ? isLink ? `a[href=${JSON.stringify(path)}]` : `form[action=${JSON.stringify(path)}]`
          : interactionSelector(element, label)
        if (!selector) continue
        if (seen.has(selector)) continue
        seen.add(selector)
        store.addRenderedElement(endpointId, {
          url: sourceUrl,
          method: input.method,
          selector,
          tag,
          ...(element.type ? { inputType: element.type } : {}),
          isFormField: false,
          attributes: path
            ? isLink ? { href: path } : { action: path, method: method === 'POST' ? 'POST' : 'GET' }
            : safeInteractionAttributes(attrs, inputAction),
          text: (element.text || (inputAction ? attrs.value : undefined))?.replace(/\s+/g, ' ').trim().slice(0, 120),
        })
        nodes++
      }
    }
  }

  forensic?.log({
    type: 'render-trace',
    agent: 'render-bridge',
    tool: 'recordRenderTrace',
    metadata: {
      phase: `formFields=${trace.formFields.length} interactions=${trace.elements.filter(isPageInteraction).length} payloadHits=${trace.payloadHits.length} nodes=${nodes}`,
    },
  } as any)

  return trace
}

function isPageInteraction(element: RenderTrace['elements'][number]): boolean {
  const { tag, attributes } = element
  const role = (attributes.role ?? '').toLowerCase()
  const inputType = (attributes.type ?? '').toLowerCase()
  return (tag === 'a' && Boolean(attributes.href || attributes.routerlink || attributes.routerLink || attributes['data-route'] || attributes['data-href']))
    || tag === 'form'
    || tag === 'button'
    || (tag === 'input' && ['button', 'submit'].includes(inputType))
    || ['button', 'link', 'tab', 'menuitem'].includes(role)
    || Boolean(attributes.onclick && (element.text || attributes['aria-label'] || attributes.title))
}

function interactionSelector(element: RenderTrace['elements'][number], label: string): string | undefined {
  const { tag, attributes } = element
  const base = attributes.id
    ? `#${attributes.id}`
    : attributes['data-testid']
      ? `[data-testid=${JSON.stringify(attributes['data-testid'])}]`
      : attributes.name
        ? `${tag}[name=${JSON.stringify(attributes.name)}]`
        : attributes['aria-label']
          ? `${tag}[aria-label=${JSON.stringify(attributes['aria-label'])}]`
          : tag
  if (label) return `${base}:has-text(${JSON.stringify(label)})`
  if (attributes.id || attributes['data-testid'] || attributes.name || attributes['aria-label']) return base
  return undefined
}

function safeInteractionAttributes(attributes: Record<string, string>, includeButtonValue = false): Record<string, string> {
  const allowed = ['role', 'type', 'name', 'aria-label', 'title', 'data-route', 'data-href', 'routerlink', 'routerLink']
  if (includeButtonValue) allowed.push('value')
  return Object.fromEntries(Object.entries(attributes).filter(([name]) => allowed.includes(name)))
}

/** Capture the current browser DOM, including SPA-rendered controls that have no response body. */
export async function recordRenderTraceFromPage(page: any): Promise<void> {
  try {
    const url = String(await page?.url?.() ?? '')
    if (!/^https?:\/\//i.test(url) || typeof page?.content !== 'function') return
    const body = await page.content()
    if (typeof body !== 'string' || !body || body.length > 1_000_000) return
    recordRenderTraceFromResponse({ url, method: 'GET', contentType: 'text/html', body })
  } catch {
    // Best-effort learning; browser interaction and evidence paths continue.
  }
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

  const handler = (response: any) => {
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
  }
  try {
    page.on('response', handler)
  } catch {
    renderWiredPages.delete(page)
  }
}
