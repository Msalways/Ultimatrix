/**
 * BuddyMessage (web) — render test via react-dom/server (no jsdom needed).
 * Asserts the buddy's answer markdown becomes a GFM table + a highlighted
 * code block in the SSR markup. XSS-safe: no raw HTML injection.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { BuddyMessage } from '../../src/components/BuddyMessage'
import { createRenderModel, reduceMessage } from '../../src/output/render-model'
import type { SolverStreamMessage } from '../../src/solver/solver'

const ANSWER = [
  '# Scan summary',
  '',
  'We found **2 issues**:',
  '',
  '| severity | technique | endpoint |',
  '| --- | --- | --- |',
  '| high | sql-injection | /api/users |',
  '| medium | idor | /api/orders/123 |',
  '',
  '```js',
  'const payload = "\x27 OR 1=1--"',
  '```',
].join('\n')

describe('BuddyMessage — web markdown render', () => {
  it('T2.5 renders a GFM table and highlighted code block', () => {
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: ANSWER } as SolverStreamMessage)
    const html = renderToStaticMarkup(createElement(BuddyMessage, { model }))

    // Table rendered (th cells present).
    expect(html).toContain('<th')
    expect(html).toContain('severity')
    expect(html).toContain('sql-injection')

    // Code block rendered via syntax highlighter (pre + code with language class).
    expect(html).toContain('<pre')
    expect(html).toContain('language-js')
    expect(html).toContain('OR 1=1')

    // Inline strong -> instrument color span.
    expect(html).toContain('<strong')

    // No raw, unescaped script injection possible (XSS-safe by default).
    expect(html).not.toContain('<script')
  })
})
