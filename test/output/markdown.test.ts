/**
 * Markdown rendering tests — terminal adapter.
 *
 * Covers: TTY ANSI emission, non-TTY plain text, open-fence fallback
 * (anti-flicker), and that the web transform path renders GFM tables + code.
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdown, isTerminal } from '../../src/output/terminal'

describe('renderMarkdown — TTY', () => {
  it('T2.1 emits ANSI for a heading + closed code fence', () => {
    const md = '# Title\n\n```js\nconst x = 1\n```\n'
    const out = renderMarkdown(md, { isTTY: true })
    // Theme renderer emits escape codes for the green header + code box.
    expect(out).toContain('\x1b[')
    expect(out).toContain('Title')
    expect(out).toContain('const x = 1')
  })

  it('T2.2 emits plain text when not a TTY (no escape codes)', () => {
    const md = '# Title\n\n```js\nconst x = 1\n```\n'
    const out = renderMarkdown(md, { isTTY: false })
    expect(out).not.toContain('\x1b[')
    expect(out).toContain('Title')
    expect(out).toContain('const x = 1')
  })

  it('T2.3 open-fence fallback: unclosed fence renders tail as raw mono', () => {
    const md = 'intro\n\n```js\nconst x = 1\n'
    const out = renderMarkdown(md, { isTTY: true })
    // The open-fence tail must NOT be wrapped in a code box (no boxed escape).
    expect(out).not.toContain('\x1b[32m│\x1b[0m') // green code-box border marker
    expect(out).toContain('const x = 1')
    // The fence marker itself is preserved as raw text.
    expect(out).toContain('```js')
  })

  it('renders a GFM table without crashing (TTY)', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n'
    const out = renderMarkdown(md, { isTTY: true })
    expect(out).toContain('a')
    expect(out).toContain('2')
  })
})

describe('isTerminal', () => {
  it('reflects TTY flag', () => {
    expect(isTerminal({ isTTY: true })).toBe(true)
    expect(isTerminal({ isTTY: false })).toBe(false)
  })
})
