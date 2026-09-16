import { describe, it, expect, vi } from 'vitest'
import { ChatStream } from '../../src/output/layout'
import {
  createRenderModel,
  reduceMessage,
  argsSummary,
  resultSummary,
  visibleAssistantText,
  type RenderModel,
} from '../../src/output/render-model'
import type { SolverStreamMessage } from '../../src/solver/solver'

const noTTY = { isTTY: false, write: () => {} }

function feed(msgs: SolverStreamMessage[]): RenderModel {
  const m = createRenderModel()
  for (const msg of msgs) reduceMessage(m, msg)
  return m
}

describe('chat: contract reducer (tool-result.result)', () => {
  it('stores structured result on tool-result without scraping', () => {
    const m = feed([
      { kind: 'tool', name: 'httpRequest', args: { method: 'POST', url: 'https://x/api/login' } },
      { kind: 'tool-result', name: 'httpRequest', ok: true, result: 'HTTP 200 {"token":".."}' },
    ])
    expect(m.tools).toHaveLength(1)
    expect(m.tools[0].state).toBe('ok')
    expect(m.tools[0].result).toBe('HTTP 200 {"token":".."}')
  })

  it('matches result to the in-flight start by name', () => {
    const m = feed([
      { kind: 'tool', name: 'queryGraph', args: { query: 'MATCH (e:Endpoint)' } },
      { kind: 'tool', name: 'queryGraph', args: { query: 'MATCH (f:Fact)' } },
      { kind: 'tool-result', name: 'queryGraph', ok: true, result: 'rows: 3' },
    ])
    expect(m.tools[1].result).toBe('rows: 3')
    expect(m.tools[0].result).toBeUndefined()
  })

  it('stores runtime assistant events for activity rendering', () => {
    const m = feed([
      { kind: 'event', event: 'model.selected', label: 'brain openai/gpt-4o', status: 'ok', data: { role: 'brain' } },
      { kind: 'event', event: 'memory.loaded', label: 'graph memory 2 endpoints', status: 'ok' },
    ] as SolverStreamMessage[])
    expect(m.events).toHaveLength(2)
    expect(m.events[0].event).toBe('model.selected')
    expect(m.events[1].label).toContain('graph memory')
  })

  it('argsSummary reads structural keys only (no vocab enumeration)', () => {
    expect(argsSummary({ method: 'post', url: 'https://x/a' })).toBe('POST https://x/a')
    expect(argsSummary({ endpoint: '/api/login', technique: 'sqli' })).toBe('/api/login sqli')
    expect(argsSummary({ severity: 'high' })).toBe('sev:high')
    expect(argsSummary({ foo: 'bar' })).toContain('foo')
  })

  it('hides JSON-shaped fake tool calls from assistant output', () => {
    const text = '{"tool":"listTools","arguments":{"prefix":""}}'
    expect(visibleAssistantText(text)).toBe('')
    const m = feed([{ kind: 'done', answer: { content: text, reasoning: '', findings: [], completed: false, status: 'response_complete', durationMs: 1, steps: 0, toolCalls: 0, newFindings: 0 } }])
    expect(m.answer).toBe('')
  })

  it('resultSummary compacts whitespace and truncates', () => {
    expect(resultSummary('  a\n  b  c  ')).toBe('a b c')
    expect(resultSummary('x'.repeat(200))!.endsWith('…')).toBe(true)
  })
})

describe('chat: delta dedup (no N× repetition of reasoning/answer)', () => {
  it('skips a reasoning delta that is a full repeat of the current buffer', () => {
    const text = 'The user just sent another "hi"...'
    const m = feed([
      { kind: 'reasoning', text, index: 0 },
      { kind: 'reasoning', text, index: 1 },
      { kind: 'reasoning', text, index: 2 },
      { kind: 'reasoning', text, index: 3 },
    ])
    expect(m.reasoning).toBe(text)
    expect(m.reasoning).not.toContain(text + text)
  })

  it('skips an answer delta that is a full repeat of the current buffer', () => {
    const text = 'Hey! How can I help you today?'
    const m = feed([
      { kind: 'answer', text, index: 0 },
      { kind: 'answer', text, index: 1 },
    ])
    expect(m.answer).toBe(text)
  })

  it('accumulates true-increment deltas (different text each chunk)', () => {
    const m = feed([
      { kind: 'reasoning', text: 'think', index: 0 },
      { kind: 'reasoning', text: ' thinking more', index: 1 },
    ])
    expect(m.reasoning).toBe('think thinking more')
  })

  it('treats a prefix-extending delta as cumulative (supersede, not append)', () => {
    // nvidia-style: chunk2 = full text-so-far + a few more chars.
    const m = feed([
      { kind: 'answer', text: 'Hello', index: 0 },
      { kind: 'answer', text: 'Hello world', index: 1 },
    ])
    expect(m.answer).toBe('Hello world')
  })

  it('skips a delta that is a redundant tail of the current buffer', () => {
    const m = feed([
      { kind: 'reasoning', text: 'think deeply', index: 0 },
      { kind: 'reasoning', text: 'deeply', index: 1 },
    ])
    expect(m.reasoning).toBe('think deeply')
  })
})

describe('chat: live paint writes only the new tail (not the full variable)', () => {
  it('nvidia-style cumulative reasoning prints each advance once, never re-echoed', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s), showReasoning: true })
    cs.begin('g')
    // nvidia sends the full text-so-far each chunk, advancing by a few chars.
    const chunks = [
      'The user is just saying "hi"',
      'The user is just saying "hi" repeatedly.',
      'The user is just saying "hi" repeatedly. I should',
    ]
    for (const c of chunks) cs.push(feed([{ kind: 'reasoning', text: c, index: 0 }]))
    const out = writes.join('')
    // Each cumulative advance appears exactly once (no N× re-echo of the whole var).
    expect(out).toContain('The user is just saying "hi"')
    const occurrences = out.split('The user is just saying "hi"').length - 1
    expect(occurrences).toBe(1)
    // The latest tail text is present.
    expect(out).toContain('I should')
  })

  it('incremental reasoning typewriter prints only new suffix each push', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s), showReasoning: true })
    cs.begin('g')
    cs.push(feed([{ kind: 'reasoning', text: 'think', index: 0 }]))
    cs.push(feed([{ kind: 'reasoning', text: 'think more', index: 0 }]))
    const out = writes.join('')
    // 'think' printed once; ' more' (the new suffix) printed once — not 'think' twice.
    expect(out).toContain('think')
    expect(out.indexOf('think')).toBe(out.lastIndexOf('think'))
  })
})

describe('chat: card boundaries (normal scrollback, no alternate screen)', () => {
  it('begin(prompt) shows the user prompt; final() prints a footer', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: false, write: (s) => writes.push(s) })
    cs.begin('test the login')
    cs.final(feed([{ kind: 'answer', text: '# hi', index: 0 }]))
    const joined = writes.join('')
    expect(joined).toContain('▸ you: test the login')
    expect(joined).not.toContain('goal:')
    expect(joined).toMatch(/done|stopped/)
    expect(joined).toContain('tools')
  })

  it('begin(goal only) shows goal label for autonomous runs', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: false, write: (s) => writes.push(s) })
    cs.begin(undefined, 'Perform a comprehensive security assessment')
    cs.final(feed([{ kind: 'answer', text: '# hi', index: 0 }]))
    const joined = writes.join('')
    expect(joined).toContain('goal: Perform a comprehensive security assessment')
    expect(joined).not.toContain('▸ you:')
  })

  it('does NOT emit alternate-screen escapes (no black flicker)', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s) })
    cs.begin('goal')
    cs.push(feed([{ kind: 'reasoning', text: 'think', index: 0 }]))
    cs.push(feed([{ kind: 'answer', text: '# a', index: 0 }]))
    cs.final(feed([{ kind: 'answer', text: '# a', index: 0 }]))
    const joined = writes.join('')
    expect(joined).not.toContain('\x1b[?1049h')
    expect(joined).not.toContain('\x1b[?1049l')
  })

  it('renders tool rows with status marks and compact result', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: false, write: (s) => writes.push(s) })
    cs.begin('g')
    cs.push(feed([
      { kind: 'tool', name: 'httpRequest', args: { method: 'GET', url: 'https://x' } },
      { kind: 'tool-result', name: 'httpRequest', ok: true, result: 'HTTP 200 ok' },
    ]))
    cs.final(feed([]))
    const joined = writes.join('')
    expect(joined).toContain('httpRequest')
    expect(joined).toContain('HTTP 200 ok')
  })

  it('renders live reasoning in violet on TTY, plain on non-TTY', () => {
    const ttyWrites: string[] = []
    const tty = new ChatStream({ isTTY: true, write: (s) => ttyWrites.push(s), showReasoning: true })
    tty.begin('g')
    tty.push(feed([{ kind: 'reasoning', text: 'I will probe the login', index: 0 }]))
    expect(ttyWrites.join('')).toContain('\x1b[35m') // violet

    const plainWrites: string[] = []
    const plain = new ChatStream({ isTTY: false, write: (s) => plainWrites.push(s), showReasoning: true })
    plain.begin('g')
    plain.push(feed([{ kind: 'reasoning', text: 'I will probe the login', index: 0 }]))
    expect(plainWrites.join('')).not.toContain('\x1b[35m')
    expect(plainWrites.join('')).toContain('I will probe the login')
  })

  it('collapses reasoning into a cyan header on final', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s), showReasoning: true })
    cs.begin('g')
    cs.push(feed([{ kind: 'reasoning', text: 'line one\nline two', index: 0 }]))
    cs.final(feed([{ kind: 'reasoning', text: 'line one\nline two', index: 0 }]))
    const joined = writes.join('')
    expect(joined).toContain('\x1b[36m') // cyan
    expect(joined).toContain('reasoning (2 lines)')
    expect(joined).toContain('type /r to expand')
    // The collapse header is written AFTER the live violet region (which is
    // erased in place on a real terminal), so it is the final reasoning render.
    expect(joined.indexOf('type /r to expand')).toBeGreaterThan(joined.lastIndexOf('\x1b[35m'))
  })

  it('toggleReasoning expands the full reasoning in cyan', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s), showReasoning: true })
    cs.begin('g')
    cs.push(feed([{ kind: 'reasoning', text: 'line one\nline two', index: 0 }]))
    cs.final(feed([{ kind: 'reasoning', text: 'line one\nline two', index: 0 }]))
    writes.length = 0
    cs.toggleReasoning(feed([{ kind: 'reasoning', text: 'line one\nline two', index: 0 }]))
    const joined = writes.join('')
    expect(joined).toContain('line one')
    expect(joined).toContain('line two')
  })

  it('showReasoning:false hides the live violet region and the collapsed block', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s), showReasoning: false })
    cs.begin('g')
    cs.push(feed([
      { kind: 'reasoning', text: 'secret scratch', index: 0 },
      { kind: 'answer', text: 'the answer', index: 1 },
    ]))
    cs.final(feed([
      { kind: 'reasoning', text: 'secret scratch', index: 0 },
      { kind: 'answer', text: 'the answer', index: 1 },
    ]))
    const joined = writes.join('')
    // No violet reasoning region, no cyan collapsed header.
    expect(joined).not.toContain('\x1b[35m')
    expect(joined).not.toContain('reasoning (')
    expect(joined).not.toContain('type /r to expand')
    // The deliverable is still shown.
    expect(joined).toContain('the answer')
  })

  it('shows reasoning by default', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s) })
    const model = feed([{ kind: 'reasoning', text: 'private scratch', index: 0 }])
    cs.begin('g')
    cs.push(model)
    cs.final(model)
    expect(writes.join('')).toContain('private scratch')
  })
  it('cap-renders into plain stream when answer exceeds live cap (no throw)', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s), width: 80 })
    const big = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const m = feed([{ kind: 'answer', text: big, index: 0 }])
    expect(() => { cs.begin('g'); cs.push(m); cs.final(m) }).not.toThrow()
  })

  it('keeps appending answer chunks after live cap is exceeded', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s), width: 80 })
    const big = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    cs.begin('g')
    cs.push(feed([{ kind: 'answer', text: 'short', index: 0 }]))
    cs.push(feed([{ kind: 'answer', text: big, index: 1 }]))
    cs.push(feed([{ kind: 'answer', text: `${big}\ntail-final`, index: 2 }]))
    expect(writes.join('')).toContain('tail-final')
  })

  it('empty turn shows a no-output note with footer', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: false, write: (s) => writes.push(s) })
    cs.begin('g')
    cs.final(feed([]))
    const joined = writes.join('')
    expect(joined).toContain('no output')
  })
})

describe('chat: pause/resume hooks are optional no-ops', () => {
  it('works without host pause/resume', () => {
    const writes: string[] = []
    const cs = new ChatStream({ isTTY: true, write: (s) => writes.push(s) })
    expect(() => {
      cs.begin('g')
      cs.push(feed([{ kind: 'answer', text: 'x', index: 0 }]))
      cs.final(feed([{ kind: 'answer', text: 'x', index: 0 }]))
    }).not.toThrow()
  })
})

describe('F39: StreamSegment chronological ordering', () => {
  it('records segments in arrival order with monotonically increasing seq', () => {
    const m = feed([
      { kind: 'reasoning', text: 'thinking 1' },
      { kind: 'tool', name: 'httpRequest', args: { url: 'https://x' } },
      { kind: 'reasoning', text: 'thinking 2' },
      { kind: 'tool-result', name: 'httpRequest', ok: true, result: '200 ok' },
      { kind: 'answer', text: 'the answer' },
    ])
    expect(m.segments).toHaveLength(5)
    const seqs = m.segments.map(s => s.seq)
    // Strictly increasing
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
    // Kinds match original order
    expect(m.segments.map(s => s.kind)).toEqual([
      'reasoning', 'tool', 'reasoning', 'tool-result', 'answer',
    ])
  })

  it('segments have timestamps', () => {
    const before = Date.now()
    const m = feed([{ kind: 'answer', text: 'hello' }])
    expect(m.segments).toHaveLength(1)
    expect(m.segments[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(m.segments[0].timestamp).toBeLessThanOrEqual(Date.now())
  })

  it('segments payload preserves original message shape', () => {
    const msg: SolverStreamMessage = { kind: 'event', event: 'model.selected', label: 'brain gpt-4o', status: 'ok' }
    const m = feed([msg])
    expect(m.segments[0].payload.kind).toBe('event')
    expect((m.segments[0].payload as any).event).toBe('model.selected')
  })
})
