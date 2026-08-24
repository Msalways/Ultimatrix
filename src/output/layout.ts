/**
 * ChatStream — inline "chat card" terminal renderer for `ultimatrix interact`.
 *
 * Model: opencode / Claude Code style — each turn is a BOUNDED CARD printed
 * into the NORMAL terminal scrollback (NOT an alternate-screen takeover). This
 * avoids the black-flicker failure mode of a full-screen TUI and keeps long
 * answers naturally scrollable + re-readable, which is the whole point.
 *
 * Per-turn card layout (top → bottom, all in the live scrollback):
 *   ──────── goal: <line> ───────────────   header (dim)
 *   ⟢ thinking (violet, live)                  live reasoning (dim violet, in-place redraw)
 *     ▸ httpRequest  POST /api/login           permanent tool rows
 *     ✓ writeFinding  HIGH sqli
 *   # answer markdown …                         trailing LIVE region (in-place redraw)
 *   ▸ reasoning (N lines) — Ctrl-R to expand    collapsed (cyan) on final; expandable
 *   ──────── done · N steps · M tools ──────   footer (permanent, on final)
 *
 * Design rules (no bandaids, no hardcoded vocab):
 *  - Renders from structured `RenderModel` only. Phase/tool/finding state is
 *    derived from typed fields — zero regex / keyword scanning.
 *  - Trailing live region uses visual-row-aware erase (countVisualRows) so wrapped
 *    lines erase correctly (no duplicated frames).
 *  - Degrades to plain escape-free streaming when not a TTY, or when the answer
 *    exceeds the live cap (falls back to append-only streaming).
 *  - The web UI never imports this file; it consumes the same RenderModel.
 */

import {
  renderMarkdown,
  countVisualRows,
  type TerminalPaintOptions,
} from './terminal'
import {
  type RenderModel,
  argsSummary,
  resultSummary,
  visibleAssistantText,
} from './render-model'

const ESC = {
  up: (n: number) => `\x1b[${n}A`,
  clearDown: '\x1b[J',
  clearLine: '\x1b[K',
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

const SEV_GLYPH: Record<string, string> = {
  critical: '✗',
  high: '✗',
  medium: '!',
  low: '·',
  info: '·',
}

/** Above this many visual rows, the answer stops in-place redraw and appends. */
const LIVE_CAP = 60

export interface ChatOptions extends TerminalPaintOptions {
  /** Width hint (defaults to process.stdout.columns). */
  width?: number
  /** Show the model's reasoning (live violet + collapsed block). Default: true. */
  showReasoning?: boolean
}

function widthOf(opts: ChatOptions): number {
  return opts.width ?? (typeof process !== 'undefined' ? process.stdout?.columns : undefined) ?? 80
}

function formatDuration(ms = 0): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function footer(model: RenderModel): string {
  const done = model.done
  const steps = done?.steps ?? model.step
  const tools = done?.toolCalls ?? model.tools.length
  const findings = done?.findings?.length ?? model.findings.length
  const status = done?.status ?? (model.complete ? 'done' : 'stopped')
  const duration = done?.durationMs ? ` · ${formatDuration(done.durationMs)}` : ''
  return `${status} · ${steps} ${steps === 1 ? 'step' : 'steps'} · ${tools} ${tools === 1 ? 'tool' : 'tools'} · ${findings} ${findings === 1 ? 'finding' : 'findings'}${duration}`
}

/**
 * Inline chat-card renderer. One instance per interactive turn. Drives the
 * structured `RenderModel` as messages arrive; paints a bounded, scrollable card.
 */
export class ChatStream {
  private opts: ChatOptions
  private write: (s: string) => void
  private tty: boolean

  private begun = false
  private toolRows = new Map<number, string>() // id → last rendered tool line
  private eventRows = new Set<number>()
  private liveThinkingRows = 0
  private liveAnswerRows = 0
  private paintedReasoningLen = 0 // chars of model.reasoning already written to the live region
  private paintedAnswerLen = 0 // chars of model.answer already written to the live region
  private answerCapped = false
  private reasoningExpanded = false
  private finalized = false
  private finalizedReasoningShown = false

  constructor(opts: ChatOptions = {}) {
    this.opts = opts
    this.write = opts.write ?? ((s: string) => process.stdout.write(s))
    this.tty = opts.isTTY ?? (typeof process !== 'undefined' ? Boolean(process.stdout?.isTTY) : false)
  }

  private c(code: string): string {
    return this.tty ? code : ''
  }

  /**
   * Open the turn card. Renders the USER'S prompt (what they typed) as the
   * header — honest labeling, since the `>` line already shows it. Falls back to
   * the solver `goal` only for autonomous runs (e.g. `ultimatrix solve`) where no
   * interactive prompt exists. Never invents a "goal" label for a chat message.
   */
  begin(prompt?: string, goal?: string): void {
    if (this.begun) return
    this.begun = true
    this.paintedReasoningLen = 0
    this.paintedAnswerLen = 0
    const label = prompt && prompt.trim()
      ? `▸ you: ${prompt.trim()}`
      : goal && goal.trim()
        ? `goal: ${goal.trim()}`
        : 'turn'
    const truncated = label.length > 70 ? label.slice(0, 67) + '…' : label
    this.write(`${this.c(ESC.dim)}────── ${truncated} ──────────────${this.c(ESC.reset)}\n`)
  }

  /** Fold a stream message into the model and repaint the live portions. */
  push(model: RenderModel): void {
    if (!this.begun) this.begin(model.goal, model.goal)
    this.renderThinking(model)
    this.renderEvents(model)
    this.renderTools(model)
    this.renderAnswer(model)
  }

  private renderEvents(model: RenderModel): void {
    for (const e of model.events) {
      if (this.eventRows.has(e.id)) continue
      const mark = e.status === 'ok' ? `${this.c(ESC.green)}✓${this.c(ESC.reset)}`
        : e.status === 'warn' ? `${this.c(ESC.yellow)}!${this.c(ESC.reset)}`
          : e.status === 'error' ? `${this.c(ESC.red)}✗${this.c(ESC.reset)}`
            : e.status === 'running' ? `${this.c(ESC.cyan)}…${this.c(ESC.reset)}`
              : `${this.c(ESC.dim)}·${this.c(ESC.reset)}`
      this.write(`  ${mark} ${this.c(ESC.dim)}${e.label}${this.c(ESC.reset)}\n`)
      this.eventRows.add(e.id)
    }
  }

  /**
   * Live reasoning region (dim violet). Rendered above the answer while the
   * model is still thinking. Only the UNPAINTED TAIL of `model.reasoning` is
   * written on each push — the full variable is never re-echoed. The buffer
   * itself is kept single-copy by `appendDelta` (cumulative providers
   * supersede), so the tail is always the genuinely-new text. A full erase +
   * redraw happens only in `final()`.
   */
  private renderThinking(model: RenderModel): void {
    if (this.opts.showReasoning === false) return
    if (!model.reasoning.trim()) return
    const tail = model.reasoning.slice(this.paintedReasoningLen)
    this.paintedReasoningLen = model.reasoning.length
    if (!tail) return
    const text = tail.replace(/\s+$/, '')
    if (!text) return
    const rows = text.split('\n')
    const rendered = rows
      .map((r) => `${this.c(ESC.violet)}${r || ' '}${this.c(ESC.reset)}`)
      .join('\n')
    this.write(rendered + '\n')
    this.liveThinkingRows += rows.length
  }

  /** Toggle the collapsed reasoning block open/closed (Ctrl-R / /r). */
  toggleReasoning(model?: RenderModel): void {
    if (this.opts.showReasoning === false) return
    if (this.finalized && model?.reasoning.trim()) {
      if (this.finalizedReasoningShown) {
        this.write(`${this.c(ESC.dim)}reasoning already shown${this.c(ESC.reset)}\n`)
        return
      }
      const body = model.reasoning.trim().split('\n')
        .map((line) => `${this.c(ESC.cyan)}${line || ' '}${this.c(ESC.reset)}`)
        .join('\n')
      this.write(body + '\n')
      this.finalizedReasoningShown = true
      return
    }
    this.reasoningExpanded = !this.reasoningExpanded
    if (model && this.begun) this.final(model)
  }

  private renderTools(model: RenderModel): void {
    for (const t of model.tools) {
      const prev = this.toolRows.get(t.id)
      const mark = t.state === 'ok' ? `${this.c(ESC.green)}✓${this.c(ESC.reset)}` : t.state === 'err' ? `${this.c(ESC.red)}✗${this.c(ESC.reset)}` : `${this.c(ESC.yellow)}…${this.c(ESC.reset)}`
      const summary = argsSummary(t.args)
      let line = `  ${mark} ${this.c(ESC.cyan)}${t.name}${this.c(ESC.reset)}` + (summary ? `  ${this.c(ESC.dim)}${summary}${this.c(ESC.reset)}` : '')
      if (t.result) {
        const body = resultSummary(t.result)
        if (body) line += `  ${this.c(ESC.gray)}${body}${this.c(ESC.reset)}`
      }
      if (prev === undefined) {
        this.write(line + '\n')
        this.toolRows.set(t.id, line)
      } else if (prev !== line) {
        // Append updates instead of cursor surgery; tool results can arrive
        // after answer output, so moving up one row corrupts the wrong line.
        this.write(line + '\n')
        this.toolRows.set(t.id, line)
      }
    }
  }

  private renderAnswer(model: RenderModel): void {
    const answer = visibleAssistantText(model.answer)
    if (!answer.trim()) return
    const width = widthOf(this.opts)
    const rendered = renderMarkdown(answer, { ...this.opts, isTTY: this.tty })
    const rows = countVisualRows(rendered, width)

    if (this.tty && !this.answerCapped && rows <= LIVE_CAP) {
      // Erase the previous answer region, then redraw in place.
      if (this.liveAnswerRows > 0) {
        this.write(ESC.up(this.liveAnswerRows) + ESC.clearDown)
      }
      const caret = !model.complete ? `${this.c(ESC.dim)}▊${this.c(ESC.reset)}` : ''
      this.write(rendered + caret + '\n')
      this.liveAnswerRows = rows + (model.complete ? 0 : 1)
      this.paintedAnswerLen = answer.length
    } else {
      // Non-TTY or answer exceeded the live cap → append-only plain stream.
      if (!this.answerCapped) {
        // First time hitting the cap: flush what we have as plain text once.
        if (this.liveAnswerRows > 0 && this.tty) {
          this.write(ESC.up(this.liveAnswerRows) + ESC.clearDown)
          this.liveAnswerRows = 0
          this.paintedAnswerLen = 0
        }
        this.answerCapped = true
      }
      const tail = answer.slice(this.paintedAnswerLen)
      if (!tail) return
      this.paintedAnswerLen = answer.length
      this.write(renderMarkdown(tail, { ...this.opts, isTTY: false }))
    }
  }

  /** Finalize: collapse thinking into a cyan block, render clean answer, footer. */
  final(model: RenderModel): void {
    if (!this.begun) return
    this.finalized = true
    // Erase the live thinking region so the collapsed block replaces it cleanly.
    if (this.liveThinkingRows > 0 && this.tty) {
      this.write(ESC.up(this.liveThinkingRows) + ESC.clearDown)
      this.liveThinkingRows = 0
    }
    this.paintedReasoningLen = 0
    // Erase the live answer region (no caret on final).
    if (this.liveAnswerRows > 0 && this.tty && !this.answerCapped) {
      this.write(ESC.up(this.liveAnswerRows) + ESC.clearDown)
    }
    const answer = visibleAssistantText(model.answer)
    if (answer.trim() && !this.answerCapped) {
      const rendered = renderMarkdown(answer, { ...this.opts, isTTY: this.tty })
      this.write(rendered + '\n')
    }
    // Collapsed / expanded reasoning block (cyan), above the footer. Only when
    // reasoning visibility is enabled — this is the buddy's decision context.
    if (this.opts.showReasoning !== false && model.reasoning.trim()) {
      const lines = model.reasoning.trim().split('\n').length
      if (this.reasoningExpanded) {
        const body = model.reasoning.trim().split('\n')
          .map((r) => `${this.c(ESC.cyan)}${r || ' '}${this.c(ESC.reset)}`)
          .join('\n')
        this.write(body + '\n')
      } else {
        const head = `${this.c(ESC.cyan)}▸ reasoning (${lines} lines) — type /r to expand${this.c(ESC.reset)}`
        this.write(head + '\n')
      }
    }
    if (!model.reasoning.trim() && model.tools.length === 0 && !model.answer.trim()) {
      this.write(`${this.c(ESC.dim)}(no output — model returned no steps)${this.c(ESC.reset)}\n`)
    }
    this.write(`${this.c(ESC.dim)}─────── ${footer(model)} ───────${this.c(ESC.reset)}\n`)
    return
    const status = model.complete ? `${this.c(ESC.dim)}done${this.c(ESC.reset)}` : `${this.c(ESC.green)}stopped${this.c(ESC.reset)}`
    this.write(`${this.c(ESC.dim)}─────── ${status} · ${model.step} steps · ${model.tools.length} tools ───────${this.c(ESC.reset)}\n`)
  }
}

export { SEV_GLYPH }
