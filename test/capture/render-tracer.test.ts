import { describe, it, expect } from 'vitest'
import { traceRender, summarizeTrace } from '../../src/capture/render-tracer'

const HTML = `<!doctype html><html><body><form>
<input id="q" name="q" type="text" value="<script>alert(1)</script>">
<button id="go" onclick="submit()">Go</button>
</form><script>var x=1;</script></body></html>`

describe('render-tracer (WS-E)', () => {
  it('extracts form fields, inline handlers, and scripts from HTML', () => {
    const trace = traceRender(HTML, { payloads: ['<script>alert(1)</script>'] })
    expect(trace.html).toBe(true)
    expect(trace.formFields.map((f) => f.selector)).toContain('#q')
    expect(trace.inlineHandlers).toContain('#go@onclick')
    expect(trace.scripts.length).toBeGreaterThan(0)
  })

  it('records where a sent payload landed (grounded render evidence)', () => {
    const trace = traceRender(HTML, { payloads: ['<script>alert(1)</script>'] })
    const hit = trace.payloadHits.find((h) => h.selector === '#q')
    expect(hit).toBeDefined()
    expect(hit?.where).toBe('attribute')
  })

  it('returns no trace for non-HTML bodies', () => {
    const trace = traceRender('{"ok":true}', { payloads: ['x'] })
    expect(trace.html).toBe(false)
    expect(trace.formFields.length).toBe(0)
  })

  it('summarizes into a compact LLM-facing string', () => {
    const trace = traceRender(HTML, { payloads: ['<script>alert(1)</script>'] })
    const summary = summarizeTrace(trace)
    expect(summary).toContain('form field')
    expect(summary).toContain('#q')
    expect(summary).toContain('<script>alert(1)</script>')
  })
})
