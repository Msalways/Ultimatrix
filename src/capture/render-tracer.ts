/**
 * Render tracer (WS-E) — response → render traceability.
 *
 * Parses a captured HTTP response body with linkedom and produces a COMPACT
 * structured summary of the rendered DOM: form fields, inline event handlers,
 * scripts, and — critically — where a sent payload actually landed. This turns a
 * raw "200 OK" into grounded evidence: "payload '<xss>' reflected, unescaped, into
 * <input id=q value='<xss>'>". The summary (not raw DOM) is fed back to the LLM
 * via the primitive result evidence, and rendered elements are persisted as
 * RENDERED_ELEMENT graph nodes.
 *
 * linkedom is used (not Playwright) because it parses the HTML string in-process,
 * synchronously and cheaply — primitives fire many payloads × endpoints, so a
 * real browser render per step would be prohibitively slow.
 */
import { parseHTML } from 'linkedom'

export interface RenderedElement {
  tag: string
  selector: string
  id?: string
  name?: string
  type?: string
  value?: string
  isFormField: boolean
  attributes: Record<string, string>
  text?: string
}

export interface RenderTrace {
  /** Whether the body was parseable HTML at all. */
  html: boolean
  elements: RenderedElement[]
  formFields: RenderedElement[]
  inlineHandlers: string[]
  scripts: string[]
  payloadHits: Array<{ payload: string; selector: string; where: 'attribute' | 'value' | 'text' }>
}

const FORM_TAGS = new Set(['input', 'textarea', 'select', 'button'])

function looksLikeHtml(s: string): boolean {
  if (!s) return false
  const head = s.slice(0, 512).toLowerCase()
  return (
    head.includes('<html') ||
    head.includes('<body') ||
    head.includes('<!doctype') ||
    /<[a-z][\s\S]*>/.test(s.slice(0, 200))
  )
}

/** Exported helper: is this body plausibly HTML (for capture-layer triage)? */
export function isHtmlBody(s: string): boolean {
  return looksLikeHtml(s)
}

function buildSelector(tag: string, attributes: Record<string, string>): string {
  if (attributes.id) return `#${attributes.id}`
  if (attributes.name) return `${tag}[name=${attributes.name}]`
  return tag
}

export function traceRender(
  html: string,
  opts?: { payloads?: string[]; baseUrl?: string },
): RenderTrace {
  const trace: RenderTrace = {
    html: false,
    elements: [],
    formFields: [],
    inlineHandlers: [],
    scripts: [],
    payloadHits: [],
  }
  if (!looksLikeHtml(html)) return trace
  trace.html = true

  let document: any
  try {
    document = parseHTML(html).document
  } catch {
    return trace
  }
  if (!document) return trace

  for (const el of document.querySelectorAll('*')) {
    const tag = (el.tagName || '').toLowerCase()
    if (!tag) continue
    const attributes: Record<string, string> = {}
    const names = el.getAttributeNames ? el.getAttributeNames() : []
    for (const a of names) attributes[a] = el.getAttribute(a) ?? ''

    const selector = buildSelector(tag, attributes)
    const node: RenderedElement = {
      tag,
      selector,
      id: attributes.id,
      name: attributes.name,
      type: attributes.type,
      value: attributes.value,
      isFormField: FORM_TAGS.has(tag),
      attributes,
      text: (el.textContent ?? '').slice(0, 200),
    }
    trace.elements.push(node)
    if (node.isFormField) trace.formFields.push(node)
    for (const a of Object.keys(attributes)) {
      if (a.startsWith('on') && attributes[a]) trace.inlineHandlers.push(`${selector}@${a}`)
    }
  }

  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent ?? ''
    if (t.trim()) trace.scripts.push(t.slice(0, 500))
  }

  const lower = html.toLowerCase()
  for (const raw of opts?.payloads ?? []) {
    if (!raw) continue
    const p = raw.toLowerCase()
    if (!lower.includes(p)) continue
    for (const node of trace.elements) {
      const attrHit = Object.values(node.attributes).some((v) => (v || '').toLowerCase().includes(p))
      const valHit = (node.value || '').toLowerCase().includes(p)
      const textHit = (node.text || '').toLowerCase().includes(p)
      if (attrHit) trace.payloadHits.push({ payload: raw, selector: node.selector, where: 'attribute' })
      else if (valHit) trace.payloadHits.push({ payload: raw, selector: node.selector, where: 'value' })
      else if (textHit) trace.payloadHits.push({ payload: raw, selector: node.selector, where: 'text' })
    }
  }

  return trace
}

/** Compact, LLM-facing summary of a render trace. */
export function summarizeTrace(trace: RenderTrace): string {
  if (!trace.html) return 'No renderable HTML body.'
  const lines: string[] = []
  lines.push(
    `Render trace: ${trace.formFields.length} form field(s), ${trace.inlineHandlers.length} inline handler(s), ${trace.scripts.length} script block(s).`,
  )
  if (trace.formFields.length > 0) {
    lines.push(
      'Form fields: ' +
        trace.formFields
          .map((f) => `${f.tag}${f.id ? `#${f.id}` : ''}${f.name ? `[name=${f.name}]` : ''}${f.type ? `[type=${f.type}]` : ''}`)
          .join(', '),
    )
  }
  if (trace.payloadHits.length > 0) {
    for (const h of trace.payloadHits) {
      const escaped = h.where === 'value' || h.where === 'text'
      lines.push(
        `Payload ${JSON.stringify(h.payload)} rendered in ${h.selector} (${h.where})${escaped ? ' — reflected' : ''}.`,
      )
    }
  }
  if (trace.inlineHandlers.length > 0) {
    lines.push('Inline handlers: ' + trace.inlineHandlers.join(', '))
  }
  return lines.join('\n')
}
