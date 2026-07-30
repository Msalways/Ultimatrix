/**
 * Markdown rendering tests — terminal adapter.
 *
 * Covers: TTY ANSI emission, non-TTY plain text, open-fence fallback
 * (anti-flicker), and that the web transform path renders GFM tables + code.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderMarkdown, MarkdownStream, isTerminal } from '../../src/output/terminal'
import { createRenderModel, reduceMessage } from '../../src/output/render-model'
import type { SolverStreamMessage } from '../../src/solver/solver'

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

describe('MarkdownStream — streaming', () => {
  it('T2.4 live push keeps a caret at the tail while streaming', () => {
    const writes: string[] = []
    const stream = new MarkdownStream({ write: s => writes.push(s), isTTY: true })
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: 'Hello ' } as SolverStreamMessage)
    stream.push(model)
    reduceMessage(model, { kind: 'answer', text: 'world' } as SolverStreamMessage)
    stream.push(model)
    const joined = writes.join('')
    expect(joined).toContain('Hello ')
    expect(joined).toContain('world')
    expect(joined).toContain('▊') // caret while streaming
  })

  it('P9.1 redraw uses cursor-control to erase the prior in-place frame', () => {
    const writes: string[] = []
    const stream = new MarkdownStream({ write: s => writes.push(s), isTTY: true })
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: '# Heading\n\nbody line\n' } as SolverStreamMessage)
    stream.push(model)
    const firstFrame = writes.join('')
    // First paint renders markdown ANSI but must NOT yet emit a redraw escape.
    expect(firstFrame).not.toMatch(/\x1b\[\d+F/) // no cursor-up on first paint
    // Second delta must erase the prior frame in place: cursor-up + clear-to-end.
    reduceMessage(model, { kind: 'answer', text: ' more' } as SolverStreamMessage)
    stream.push(model)
    const secondFrame = writes.join('')
    expect(secondFrame).toMatch(/\x1b\[\d+F/) // cursor-up N lines (in-place erase)
    expect(secondFrame).toContain('\x1b[J') // clear to end of screen
  })

  it('P9.1 tool events print above the live region; findings render from done', () => {
    const writes: string[] = []
    const stream = new MarkdownStream({ write: s => writes.push(s), isTTY: true })
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: 'analyzing\n' } as SolverStreamMessage)
    stream.push(model)
    reduceMessage(model, { kind: 'tool', name: 'httpRequest', state: 'start' } as SolverStreamMessage)
    reduceMessage(model, { kind: 'answer', text: ' done' } as SolverStreamMessage)
    stream.push(model)
    expect(writes.join('')).toContain('httpRequest') // tool line printed
    // Findings arrive on the final `done` message (contract: no live finding kind).
    reduceMessage(model, {
      kind: 'done',
      answer: {
        content: 'done',
        findings: [{ id: 'f1', severity: 'low', technique: 'sqli', endpoint: '/api' }],
        steps: 2, toolCalls: 1, durationMs: 10, status: 'ok',
      },
    } as SolverStreamMessage)
    stream.final(model)
    const joined = writes.join('')
    expect(joined).toContain('✓') // low-severity finding glyph
    expect(joined).toContain('LOW')
    expect(joined).toContain('sqli')
  })

  it('P9.1 critical findings use the ✗ glyph', () => {
    const writes: string[] = []
    const stream = new MarkdownStream({ write: s => writes.push(s), isTTY: true })
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: 'analyzing\n' } as SolverStreamMessage)
    stream.push(model)
    reduceMessage(model, {
      kind: 'done',
      answer: {
        content: 'done',
        findings: [{ id: 'f1', severity: 'critical', technique: 'rce', endpoint: '/api' }],
        steps: 1, toolCalls: 1, durationMs: 10, status: 'ok',
      },
    } as SolverStreamMessage)
    stream.final(model)
    expect(writes.join('')).toContain('✗')
    expect(writes.join('')).toContain('CRITICAL')
  })

  it('P9.2 final() drops the caret, re-renders cleanly, and prints the done footer', () => {
    const writes: string[] = []
    const stream = new MarkdownStream({ write: s => writes.push(s), isTTY: true })
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: '# Done\n\n```js\nconst x = 1\n```\n' } as SolverStreamMessage)
    reduceMessage(model, {
      kind: 'done',
      answer: { content: '# Done\n\n```js\nconst x = 1\n```\n', steps: 3, toolCalls: 2, durationMs: 10, status: 'ok' },
    } as SolverStreamMessage)
    stream.final(model)
    const joined = writes.join('')
    expect(joined).not.toContain('▊')
    expect(joined).toContain('Done')
    expect(joined).toContain('── done ·')
  })

  it('P9.2 non-TTY path stays escape-free (piped output)', () => {
    const writes: string[] = []
    const stream = new MarkdownStream({ write: s => writes.push(s), isTTY: false })
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: '# Heading\n\nbody\n' } as SolverStreamMessage)
    reduceMessage(model, { kind: 'tool', name: 'httpRequest', state: 'start' } as SolverStreamMessage)
    stream.push(model)
    reduceMessage(model, {
      kind: 'done',
      answer: { content: '# Heading\n\nbody\n', steps: 1, toolCalls: 1, durationMs: 10, status: 'ok' },
    } as SolverStreamMessage)
    stream.final(model)
    const joined = writes.join('')
    expect(joined).not.toContain('\x1b[')
    expect(joined).toContain('Heading')
    expect(joined).not.toContain('▊')
  })

  it('P9.3 readline pause/resume hooks are invoked around redraw', () => {
    const writes: string[] = []
    const pause = vi.fn()
    const resume = vi.fn()
    const stream = new MarkdownStream({
      write: s => writes.push(s),
      isTTY: true,
      pause,
      resume,
    })
    const model = createRenderModel()
    reduceMessage(model, { kind: 'answer', text: 'a\n' } as SolverStreamMessage)
    stream.push(model)
    reduceMessage(model, { kind: 'answer', text: 'b\n' } as SolverStreamMessage)
    stream.push(model)
    // pause/resume must bracket each redrawing push (first paint + redraw).
    expect(pause).toHaveBeenCalled()
    expect(resume).toHaveBeenCalled()
    expect(pause.mock.calls.length).toBe(resume.mock.calls.length)
  })
})

describe('isTerminal', () => {
  it('reflects TTY flag', () => {
    expect(isTerminal({ isTTY: true })).toBe(true)
    expect(isTerminal({ isTTY: false })).toBe(false)
  })
})
