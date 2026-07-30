/**
 * ChatBox — the session-wide terminal owner for `ultimatrix interact`.
 *
 * Root-cause fix for the broken interact UX: previously five subsystems
 * (startup, spider, REPL prompt, solver card, council/help) each dumped to
 * stdout independently, so there was no continuous chat transcript and the
 * solver card was dressed as an autonomous security-run report.
 *
 * ChatBox is ONE renderer for the whole session. Every subsystem routes
 * through it:
 *   - `printUserMessage`   → `you: <text>` (printed on submit)
 *   - `beginAssistant`/`streamAssistant`/`endAssistant` → `assistant:` turn
 *   - `beginActivity`/`updateActivity`/`endActivity` → spider/progress live line
 *   - `printSystem`        → dim startup/status lines
 *   - `printHelp`/`printReport`/`printCouncil` → typed helpers
 *   - implements `LogSink` → any `log.*` during the session is captured
 *
 * Design rules (no bandaids, no hardcoded vocab):
 *  - Reuses `render-model.ts` (RenderModel / reduceMessage / appendDelta) and
 *    `terminal.ts` (renderMarkdown / countVisualRows / ESC).
 *  - TTY-aware: ANSI only on real terminals; escape-free when piped.
 *  - Chat framing, not solver-report framing: the `done · N steps · M tools`
 *    footer and `------ system events ------` block appear ONLY when the turn
 *    actually did work (steps>0 OR tools>0 OR findings>0). Pure chat turns are
 *    minimal: `assistant: <answer>` (+ reasoning only when present).
 *  - `chat` mode can be toggled off → caller falls back to the legacy
 *    `ChatStream` card (see createSolverRenderer). ChatBox itself is mode-agnostic.
 */

import {
  renderMarkdown,
  countVisualRows,
  type TerminalPaintOptions,
} from './terminal'
import {
  createRenderModel,
  reduceMessage,
  type RenderModel,
} from './render-model'
import type {SolverStreamMessage} from '../solver/solver'
import { setLogSink, type LogSink } from '../utils/logger'
import type { ActivitySink } from '../ui/types'

const ESC = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  violet: '\x1b[35m',
  gray: '\x1b[90m',
}

export interface ChatBoxOptions extends TerminalPaintOptions {
  /** Show model reasoning (live violet + collapsed hint). Default true. */
  showReasoning?: boolean
  /** Show the dim system-events block below a working turn. Default true. */
  showSystemEvents?: boolean
  /** Width hint. */
  width?: number
}

export interface SessionBannerMeta {
  version?: string
  model?: string
  target?: string
  engine?: string
}

type ActivityStatus = 'ok' | 'warn' | 'err'

/**
 * Persistent terminal chat renderer. One instance per interactive session.
 */
export class ChatBox implements ActivitySink {
  private opts: ChatBoxOptions
  private write: (s: string) => void
  private tty: boolean

  private showReasoning: boolean
  private showSystemEvents: boolean

  // Active assistant turn state.
  private assistantActive = false
  private model: RenderModel = createRenderModel()
  private liveAssistantRows = 0
  private paintedReasoningLen = 0
  private paintedAnswerLen = 0
  private reasoningExpanded = false

  // Active activity (spider/progress) state — a single live line.
  private activityActive = false
  private activityRows = 0

  // LogSink buffer (captured log.* lines during the session).
  private sinkBuffer: string[] = []
  private sinkInstalled = false

  constructor(opts: ChatBoxOptions = {}) {
    this.opts = opts
    this.write = opts.write ?? ((s: string) => process.stdout.write(s))
    this.tty = opts.isTTY ?? (typeof process !== 'undefined' ? Boolean(process.stdout?.isTTY) : false)
    this.showReasoning = opts.showReasoning ?? true
    this.showSystemEvents = opts.showSystemEvents ?? true
  }

  private c(code: string): string {
    return this.tty ? code : ''
  }

  private widthOf(): number {
    return this.opts.width ?? (typeof process !== 'undefined' ? process.stdout?.columns : undefined) ?? 80
  }

  // ───────────────────────────── Banner ─────────────────────────────

  /** Slim one-line session banner, printed once at startup. */
  printBanner(meta: SessionBannerMeta = {}): void {
    const parts: string[] = []
    if (meta.version) parts.push(`${meta.version}`)
    if (meta.model) parts.push(this.c(ESC.gray) + meta.model + this.c(ESC.reset))
    if (meta.target) parts.push(this.c(ESC.gray) + '· ' + meta.target + this.c(ESC.reset))
    if (meta.engine) parts.push(this.c(ESC.gray) + '· ' + meta.engine + this.c(ESC.reset))
    const line = parts.join('  ')
    if (line) this.write(this.c(ESC.bold) + line + this.c(ESC.reset) + '\n')
  }

  // ───────────────────────────── User message ─────────────────────────────

  /** Print the user's submitted line, immediately, so it pairs with the reply. */
  printUserMessage(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const label = trimmed.length > 200 ? trimmed.slice(0, 197) + '…' : trimmed
    this.write(`${this.c(ESC.green)}you:${this.c(ESC.reset)} ${label}\n`)
  }

  // ───────────────────────────── Assistant turn ─────────────────────────────

  beginAssistant(): void {
    if (this.assistantActive) this.endAssistant(this.model)
    this.assistantActive = true
    this.model = createRenderModel()
    this.liveAssistantRows = 0
    this.paintedReasoningLen = 0
    this.paintedAnswerLen = 0
    this.reasoningExpanded = false
    this.write(this.c(ESC.bold) + 'assistant:' + this.c(ESC.reset) + '\n')
  }

  /** Fold one stream message and repaint the live assistant region. */
  streamAssistant(msg: SolverStreamMessage): void {
    if (!this.assistantActive) this.beginAssistant()
    reduceMessage(this.model, msg)
    this.paintAssistantLive()
  }

  private paintAssistantLive(): void {
    const model = this.model
    // Erase the previous live frame (reasoning tail + answer tail + tool rows).
    if (this.liveAssistantRows > 0 && this.tty) {
      this.write(`\x1b[${this.liveAssistantRows}A\x1b[J`)
      this.liveAssistantRows = 0
    }

    const width = this.widthOf()
    const blocks: string[] = []

    // Live reasoning (violet), tail-only so it never re-echoes the full buffer.
    if (this.showReasoning && model.reasoning.trim()) {
      const tail = model.reasoning.slice(this.paintedReasoningLen)
      this.paintedReasoningLen = model.reasoning.length
      if (tail.trim()) {
        const rendered = renderMarkdown(tail, { ...this.opts, isTTY: this.tty })
        if (rendered.trim()) {
          blocks.push(this.c(ESC.violet) + rendered.trimEnd() + this.c(ESC.reset))
        }
      }
    }

    // Tool rows (permanent-ish, above the live answer).
    for (const t of model.tools) {
      const mark = t.state === 'ok' ? `${this.c(ESC.green)}✓${this.c(ESC.reset)}`
        : t.state === 'err' ? `${this.c(ESC.red)}✗${this.c(ESC.reset)}`
        : `${this.c(ESC.yellow)}…${this.c(ESC.reset)}`
      const summary = summarizeArgs(t.args)
      let line = `  ${mark} ${this.c(ESC.cyan)}${t.name}${this.c(ESC.reset)}`
      if (summary) line += `  ${this.c(ESC.dim)}${summary}${this.c(ESC.reset)}`
      if (t.result) {
        const body = summarizeResult(t.result)
        if (body) line += `  ${this.c(ESC.gray)}${body}${this.c(ESC.reset)}`
      }
      blocks.push(line)
    }

    // Live answer (markdown), in-place redraw of the whole answer.
    if (model.answer.trim()) {
      const rendered = renderMarkdown(model.answer, { ...this.opts, isTTY: this.tty })
      const caret = !model.complete ? `${this.c(ESC.dim)}▊${this.c(ESC.reset)}` : ''
      blocks.push(rendered.trimEnd() + caret)
    }

    if (blocks.length === 0) return
    const body = blocks.join('\n') + '\n'
    const rows = countVisualRows(body, width)
    this.write(body)
    this.liveAssistantRows = rows
  }

  /** Finalize the assistant turn with the correct chrome for chat vs work. */
  endAssistant(model?: RenderModel): void {
    if (!this.assistantActive) return
    if (model) this.model = model
    const m = this.model

    // Erase live frame.
    if (this.liveAssistantRows > 0 && this.tty) {
      this.write(`\x1b[${this.liveAssistantRows}A\x1b[J`)
    }
    this.liveAssistantRows = 0

    const didWork = (m.tools.length > 0) || (m.done?.steps ?? 0) > 0 || (m.findings.length > 0)

    const _width = this.widthOf()
    const blocks: string[] = []

    if (this.showReasoning && m.reasoning.trim()) {
      const lines = m.reasoning.trim().split('\n').length
      if (this.reasoningExpanded) {
        blocks.push(this.c(ESC.violet) + m.reasoning.trim() + this.c(ESC.reset))
      } else {
        blocks.push(this.c(ESC.cyan) + `reasoning (${lines} lines) — /r to expand` + this.c(ESC.reset))
      }
    }

    if (m.answer.trim()) {
      blocks.push(renderMarkdown(m.answer, { ...this.opts, isTTY: this.tty }).trimEnd())
    }

    if (blocks.length) this.write(blocks.join('\n') + '\n')

    // Solver-run artifacts only when the turn actually did work.
    if (didWork) {
      const steps = m.done?.steps ?? 0
      const tools = m.tools.length
      const status = m.done?.status ?? (m.complete ? 'done' : 'stopped')
      this.write(
        this.c(ESC.dim) +
        `── ${status} · ${steps} steps · ${tools} tools ──` +
        this.c(ESC.reset) + '\n'
      )
    }

    // System-events block (captured log.* lines) only for working turns.
    if (this.showSystemEvents && didWork && this.sinkBuffer.length) {
      this.flushSinkBlock()
    } else {
      // Pure chat turn: drop the captured system lines (e.g. "Steps: 0 ...")
      // so they don't leak into the next turn.
      this.sinkBuffer = []
    }

    this.assistantActive = false
  }

  toggleReasoning(): void {
    if (!this.assistantActive) return
    this.reasoningExpanded = !this.reasoningExpanded
    this.paintAssistantLive()
  }

  // ───────────────────────────── Activity (spider/progress) ─────────────────────────────

  beginActivity(label: string): void {
    if (this.activityActive) this.endActivity('ok')
    this.activityActive = true
    this.activityRows = 0
    const line = `${this.c(ESC.gray)}⠿ ${label}${this.c(ESC.reset)}`
    this.write(line + '\n')
    this.activityRows = 1
  }

  updateActivity(text: string): void {
    if (!this.activityActive) return
    if (!this.tty) {
      // Non-TTY: append plainly (no in-place rewrite), prefixed for clarity.
      this.write(`${this.c(ESC.gray)}⠿ ${text}${this.c(ESC.reset)}\n`)
      return
    }
    if (this.activityRows > 0) {
      this.write(`\x1b[${this.activityRows}A\x1b[J`)
    }
    const line = `${this.c(ESC.gray)}⠿ ${text}${this.c(ESC.reset)}`
    this.write(line + '\n')
    this.activityRows = 1
  }

  endActivity(status: ActivityStatus = 'ok', detail?: string): void {
    if (!this.activityActive) return
    const glyph = status === 'ok' ? this.c(ESC.green) + '✓'
      : status === 'warn' ? this.c(ESC.yellow) + '?'
      : this.c(ESC.red) + '✗'
    const text = detail
      ? `${glyph} ${detail}${this.c(ESC.reset)}`
      : `${glyph}${this.c(ESC.reset)}`
    if (this.tty && this.activityRows > 0) {
      this.write(`\x1b[${this.activityRows}A\x1b[J`)
    }
    this.write(text + '\n')
    this.activityActive = false
    this.activityRows = 0
  }

  // ───────────────────────────── System / misc ─────────────────────────────

  /** Dim startup/status line. */
  printSystem(text: string, level: 'info' | 'warn' | 'error' | 'success' | 'dim' = 'info'): void {
    const tag = level === 'warn' ? this.c(ESC.yellow) + '? '
      : level === 'error' ? this.c(ESC.red) + '? '
      : level === 'success' ? this.c(ESC.green) + '? '
      : this.c(ESC.gray)
    this.write(`${tag}${text}${this.c(ESC.reset)}\n`)
  }

  printHelp(text: string): void {
    this.write(text + '\n')
  }

  printReport(text: string): void {
    this.write(text + '\n')
  }

  printCouncil(text: string): void {
    this.write(this.c(ESC.cyan) + text + this.c(ESC.reset) + '\n')
  }

  // ───────────────────────────── LogSink (capture log.*) ─────────────────────────────

  /** Install ChatBox as the global log sink for the session. */
  installSink(): void {
    setLogSink(this.asSink())
    this.sinkInstalled = true
  }

  /** Restore the previous logger behavior. */
  uninstallSink(): void {
    setLogSink(null)
    this.sinkInstalled = false
    this.sinkBuffer = []
  }

  private asSink(): LogSink {
    return (level: string, msg: string) => {
      if (level === 'nl') return
      const tag = level === 'warn' ? '? '
        : level === 'error' ? '? '
        : level === 'success' ? '? '
        : ''
      this.sinkBuffer.push(`${this.c(ESC.gray)}[sys] ${tag}${msg}${this.c(ESC.reset)}`)
    }
  }

  /** Write the captured sink buffer as one dim block (no clear). */
  private flushSinkBlock(): void {
    if (!this.sinkBuffer.length) return
    this.write(this.c(ESC.dim) + '------ system events ------' + this.c(ESC.reset) + '\n')
    for (const line of this.sinkBuffer) this.write(line + '\n')
    this.write(this.c(ESC.dim) + '--------------------------' + this.c(ESC.reset) + '\n')
    this.sinkBuffer = []
  }

  /** Flush any remaining sink buffer as a system block (call at turn end). */
  flush(): void {
    if (this.showSystemEvents && this.sinkBuffer.length) {
      // Only flush inside a working turn's endAssistant; if called standalone,
      // emit as a plain block.
      this.flushSinkBlock()
    }
  }

  /**
   * Emit the captured sink buffer as a system-events block NOW and clear it.
   * Used for non-assistant turns (e.g. /council) where log.* output would
   * otherwise leak into the next assistant turn.
   */
  flushSystem(): void {
    if (this.showSystemEvents && this.sinkBuffer.length) {
      this.flushSinkBlock()
    } else {
      this.sinkBuffer = []
    }
  }
}

// ───────────────────────────── Local helpers (shape-only) ─────────────────────────────

function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') return ''
  const parts: string[] = []
  const push = (s: string) => { if (s) parts.push(s) }
  if (typeof args.method === 'string') push(args.method.toUpperCase())
  if (typeof args.url === 'string') push(String(args.url))
  else if (typeof args.endpoint === 'string') push(String(args.endpoint))
  else if (typeof args.query === 'string') push(String(args.query))
  if (typeof args.severity === 'string') push(`sev:${args.severity}`)
  if (typeof args.technique === 'string') push(String(args.technique))
  let out = parts.join(' ')
  if (!out && typeof args === 'object') {
    const json = JSON.stringify(args)
    out = json.length > 60 ? json.slice(0, 60) + '…' : json
  }
  return out.slice(0, 80)
}

function summarizeResult(result?: string): string {
  if (!result) return ''
  let preview = result.replace(/\s+/g, ' ').trim()
  if (preview.length > 80) preview = preview.slice(0, 80) + '…'
  return preview
}
