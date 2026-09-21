import { describe, it, expect } from 'vitest'
import { ChatBox } from '../../src/output/chatbox'
import { log } from '../../src/utils/logger'
import type { SolverStreamMessage } from '../../src/solver/solver'

function makeBox(showReasoning = true): { box: ChatBox; out: string[]; buf: string } {
  const out: string[] = []
  const buf = ''
  const box = new ChatBox({
    isTTY: false,
    showReasoning,
    showSystemEvents: true,
    write: (s: string) => {
      out.push(s)
    },
  })
  return { box, out, buf }
}

function join(out: string[]): string {
  return out.join('')
}

describe('ChatBox — terminal owner for interact', () => {
  it('prints the user message as a chat line', () => {
    const { box, out } = makeBox()
    box.printUserMessage('find the login bypass')
    expect(join(out)).toContain('> find the login bypass')
  })

  it('does not print an empty user message', () => {
    const { box, out } = makeBox()
    box.printUserMessage('   ')
    expect(join(out)).toBe('')
  })

  it('prints a slim banner from metadata', () => {
    const { box, out } = makeBox()
    box.printBanner({ version: 'Ultimatrix v8', model: 'groq/llama3', target: 'https://x', engine: 'solver' })
    const text = join(out)
    expect(text).toContain('Ultimatrix v8')
    expect(text).toContain('groq/llama3')
    expect(text).toContain('https://x')
  })

  it('renders a pure chat turn minimally (no solver-run footer)', () => {
    const { box, out } = makeBox()
    box.beginAssistant()
    box.streamAssistant({ kind: 'answer', text: 'Try `/login` with a null byte.' })
    box.endAssistant()
    const text = join(out)
    expect(text).toContain('null byte')
    // No "steps" footer because no work was done.
    expect(text).not.toContain('steps')
  })

  it('renders a full card with solver-run footer + reasoning hint only when work happened', () => {
    const { box, out } = makeBox()
    box.beginAssistant()
    box.streamAssistant({ kind: 'reasoning', text: 'The endpoint lacks an auth check.' })
    box.streamAssistant({ kind: 'tool', name: 'httpRequest', args: { method: 'GET', url: 'https://x/api/admin' } })
    box.streamAssistant({ kind: 'tool-result', name: 'httpRequest', ok: true, result: 'HTTP 200 OK' })
    box.streamAssistant({ kind: 'answer', text: 'IDOR confirmed on /api/admin.' })
    box.streamAssistant({ kind: 'done', answer: { steps: 3, toolCalls: 1, status: 'done' } })
    box.endAssistant()
    const text = join(out)
    expect(text).toContain('decision trace (1 lines)')
    expect(text).toContain('IDOR confirmed')
    expect(text).toContain('HTTP 200 OK')
    expect(text).toContain('── done · 3 steps · 1 tools ──')
  })

  it('shows reasoning inline only when showReasoning is true', () => {
    const { box, out } = makeBox(false)
    box.beginAssistant()
    box.streamAssistant({ kind: 'reasoning', text: 'hidden thinking' })
    box.streamAssistant({ kind: 'answer', text: 'answer text' })
    box.endAssistant()
    const text = join(out)
    expect(text).not.toContain('hidden thinking')
    expect(text).toContain('answer text')
  })

  it('routes spider activity as plain lines when non-TTY', () => {
    const { box, out } = makeBox()
    box.beginActivity('Spider crawling https://x')
    box.updateActivity('→ stagehand_navigate')
    box.updateActivity('[Spider] Progress: +2 endpoints, +1 pages, +0 findings')
    box.endActivity()
    const text = join(out)
    expect(text).toContain('Spider crawling https://x')
    expect(text).toContain('→ stagehand_navigate')
    expect(text).toContain('+2 endpoints')
    // Activity never emits the solver-run footer.
    expect(text).not.toContain('steps')
  })

  it('captures log.* via the sink and flushes it as a system block', () => {
    const { box, out } = makeBox()
    box.installSink()
    // Simulate a subsystem calling the global logger.
    log.info('Steps: 3 | Tool calls: 1')
    box.flushSystem()
    const text = join(out)
    expect(text).toContain('── system events ──')
    expect(text).toContain('Steps: 3 | Tool calls: 1')
    // Buffer cleared after flush.
    box.flushSystem()
    expect(join(out)).toBe(text)
  })

  it('drops captured system lines on a pure chat turn (no leak)', () => {
    const { box, out } = makeBox()
    box.installSink()
    log.info('Steps: 0 | Tool calls: 0')
    box.beginAssistant()
    box.streamAssistant({ kind: 'answer', text: 'hi' })
    box.endAssistant()
    const text = join(out)
    expect(text).not.toContain('system events')
    expect(text).not.toContain('Steps: 0')
  })

  it('reports an empty pure chat answer without run telemetry', () => {
    const { box, out } = makeBox()
    box.beginAssistant()
    box.streamAssistant({ kind: 'done', answer: { content: '', reasoning: '', findings: [], completed: false, status: 'response_complete', durationMs: 1, steps: 0, toolCalls: 0, newFindings: 0 } })
    box.endAssistant()
    const text = join(out)
    expect(text).toContain('(no response)')
    expect(text).not.toContain('response_complete')
    expect(text).not.toContain('system events')
    expect(text).not.toContain('steps')
  })

  it('buffers answers in non-TTY mode so final markdown is rendered once', () => {
    const { box, out } = makeBox()
    box.beginAssistant()
    box.streamAssistant({ kind: 'answer', text: 'No deliverable response was produced.' })
    // Piped output must not receive a raw streaming copy before finalization.
    expect(join(out)).toBe('')
    box.endAssistant()
    const text = join(out)
    expect(text.match(/No deliverable response was produced\./g)?.length).toBe(1)
    expect(text).not.toContain('<p>')
  })

  it('renders a structured stream failure instead of hiding it behind no response', () => {
    const { box, out } = makeBox()
    box.beginAssistant()
    box.streamAssistant({
      kind: 'event',
      event: 'turn.failed',
      label: 'Model service unavailable: Internal server error',
      status: 'error',
    })
    box.streamAssistant({ kind: 'done', answer: { content: '', reasoning: '', findings: [], completed: false, status: 'model_failed', steps: 0, toolCalls: 0 } })
    box.endAssistant()
    const text = join(out)
    expect(text).toContain('Model service unavailable: Internal server error')
    expect(text).toContain('(no response)')
  })

  it('keeps tool rows append-only while an answer is streaming', () => {
    const out: string[] = []
    const box = new ChatBox({ isTTY: true, write: (s: string) => { out.push(s) } })
    box.beginAssistant()
    box.streamAssistant({ kind: 'answer', text: 'partial answer' })
    box.streamAssistant({ kind: 'tool', name: 'httpRequest', args: { method: 'GET', url: 'https://x' } })
    const text = out.join('')
    expect(text).not.toContain('\r')
    expect(text).toContain('httpRequest')
    box.endAssistant()
  })

  it('buffers token-level reasoning instead of painting one terminal row per token', () => {
    const out: string[] = []
    const box = new ChatBox({ isTTY: true, showReasoning: true, write: (s: string) => { out.push(s) } })
    box.beginAssistant()
    box.streamAssistant({ kind: 'reasoning', text: 'Inter' })
    box.streamAssistant({ kind: 'reasoning', text: 'pret' })
    expect(out.join('')).not.toContain('Inter')
    expect(out.join('')).not.toContain('pret')
    box.endAssistant()
    expect(out.join('')).toContain('decision trace (')
  })

  it('streams coalesced brain updates separately from runtime events', () => {
    const out: string[] = []
    const box = new ChatBox({ isTTY: true, showReasoning: true, liveReasoning: true, write: (s: string) => { out.push(s) } })
    box.beginAssistant()
    box.streamAssistant({ kind: 'reasoning', text: 'I observed the captured API surface and will compare anonymous responses before attempting any state-changing test.' })
    box.streamAssistant({ kind: 'event', event: 'observation.started', label: 'observing target surface', status: 'running' })
    const text = out.join('')
    expect(text).toContain('brain')
    expect(text).toContain('runtime')
    expect(text).toContain('observed the captured API surface')
    box.endAssistant()
  })

  it('shows structured activity while keeping model scratch text out of the live card', () => {
    const out: string[] = []
    const box = new ChatBox({ isTTY: true, write: (s: string) => { out.push(s) } })
    box.beginAssistant()
    box.streamAssistant({ kind: 'phase', phase: 'observe', step: 0 })
    box.streamAssistant({ kind: 'event', event: 'recon.started', label: 'mapping links and forms', status: 'running' })
    box.streamAssistant({ kind: 'reasoning', text: 'private scratch' })
    const text = out.join('')
    expect(text).toContain('observing target surface')
    expect(text).toContain('mapping links and forms')
    expect(text).not.toContain('private scratch')
  })
})
