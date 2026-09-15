/**
 * ChatBox — session-wide terminal owner for `ultimatrix interact`.
 *
 * Streaming strategy: append-only during streaming. Tool rows and answer
 * are written once and never erased mid-stream. Reasoning is accumulated
 * silently (never shown during streaming). On finalization, the entire
 * live region (tools + answer) is erased and re-rendered in content-forward
 * order: answer first, then tools, then collapsed reasoning hint.
 *
 * Design language: near-black canvas, off-white text, phosphor green accent,
 * cyan for tool execution, red for findings. Content-forward — the answer
 * is the hero, not the chrome.
 */

import {
  renderMarkdown,
  countVisualRows,
  type TerminalPaintOptions,
} from './terminal'
import {
  createRenderModel,
  reduceMessage,
  visibleAssistantText,
  type RenderModel,
} from './render-model'
import type {SolverStreamMessage} from '../solver/solver'
import { setLogSink, type LogSink } from '../utils/logger'
import type { ActivitySink } from '../ui/types'
import { ESC } from '../ui/theme'

export interface ChatBoxOptions extends TerminalPaintOptions {
  showReasoning?: boolean
  showSystemEvents?: boolean
  width?: number
  pause?: () => void
  resume?: () => void
}

export interface SessionBannerMeta {
  version?: string
  model?: string
  target?: string
  engine?: string
}

type ActivityStatus = 'ok' | 'warn' | 'err'

export class ChatBox implements ActivitySink {
  private opts: ChatBoxOptions
  private write: (s: string) => void
  private pause?: () => void
  private resume?: () => void
  private tty: boolean
  private showReasoning: boolean
  private showSystemEvents: boolean

  // Assistant turn state
  private assistantActive = false
  private model: RenderModel = createRenderModel()
  private paintedReasoningLen = 0
  private paintedAnswerLen = 0
  private liveAnswerRows = 0
  private reasoningExpanded = false
  private finalized = false

  // Tool rows — permanent, tracked by id + actual line count
  private toolRows = new Map<number, string>()
  private toolLinesWritten = 0

  // Activity (spider/progress) state — single-line spinner
  private activityActive = false
  private activityRows = 0

  // LogSink
  private sinkBuffer: string[] = []
  private sinkInstalled = false

  constructor(opts: ChatBoxOptions = {}) {
    this.opts = opts
    this.write = opts.write ?? ((s: string) => process.stdout.write(s))
    this.pause = opts.pause
    this.resume = opts.resume
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

  printBanner(meta: SessionBannerMeta = {}): void {
    const parts: string[] = []
    if (meta.version) parts.push(meta.version)
    if (meta.model) parts.push(this.c(ESC.gray) + meta.model + this.c(ESC.reset))
    if (meta.target) parts.push(this.c(ESC.gray) + '· ' + meta.target + this.c(ESC.reset))
    if (meta.engine) parts.push(this.c(ESC.gray) + '· ' + meta.engine + this.c(ESC.reset))
    const line = parts.join('  ')
    if (line) this.write(this.c(ESC.bold) + 'ULTIMATRIX' + this.c(ESC.reset) + '  ' + line + '\n')
    this.write('\n')
  }

  // ───────────────────────────── User message ─────────────────────────────

  printUserMessage(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const label = trimmed.length > 200 ? trimmed.slice(0, 197) + '…' : trimmed
    this.write(this.c(ESC.dim) + '> ' + label + this.c(ESC.reset) + '\n')
  }

  // ───────────────────────────── Assistant turn ─────────────────────────────

  beginAssistant(): void {
    if (this.assistantActive) this.endAssistant(this.model)
    this.assistantActive = true
    this.model = createRenderModel()
    this.paintedReasoningLen = 0
    this.paintedAnswerLen = 0
    this.liveAnswerRows = 0
    this.reasoningExpanded = false
    this.finalized = false
    this.toolRows.clear()
    this.toolLinesWritten = 0
  }

  streamAssistant(msg: SolverStreamMessage): void {
    if (!this.assistantActive) this.beginAssistant()
    reduceMessage(this.model, msg)
    this.paintAssistantLive()
  }

  /**
   * Append-only streaming. Each zone is independent:
   * - Reasoning: accumulated silently in model.reasoning (never written to screen)
   * - Tools: append new/changed rows, permanent via toolRows Map
   * - Answer: append markdown delta, tracked by paintedAnswerLen + liveAnswerRows
   *
   * On endAssistant(), the entire live region is erased and re-rendered
   * in content-forward order (answer → tools → collapsed reasoning).
   */
  private paintAssistantLive(): void {
    const model = this.model

    // ── Reasoning: accumulate silently, don't write to screen ──
    if (model.reasoning.length > this.paintedReasoningLen) {
      this.paintedReasoningLen = model.reasoning.length
    }

    // ── Tool rows: append-only, tracked by id ──
    for (const t of model.tools) {
      const prev = this.toolRows.get(t.id)
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
      if (prev === undefined) {
        this.write(line + '\n')
        this.toolRows.set(t.id, line)
        this.toolLinesWritten++
      } else if (prev !== line) {
        this.write(line + '\n')
        this.toolRows.set(t.id, line)
        this.toolLinesWritten++
      }
    }

    // ── Answer: append delta only ──
    const answer = visibleAssistantText(model.answer)
    if (answer.trim()) {
      const tail = answer.slice(this.paintedAnswerLen)
      if (tail) {
        this.paintedAnswerLen = answer.length
        const rendered = renderMarkdown(tail, { ...this.opts, isTTY: this.tty })
        this.write(rendered)
        this.liveAnswerRows += countVisualRows(rendered, this.widthOf())
      }
    }
  }

  /**
   * Finalize the assistant turn. Erases the live region and re-renders
   * in content-forward order: answer (hero) → tools → collapsed reasoning
   * → findings → footer → system events.
   */
  endAssistant(model?: RenderModel): void {
    if (!this.assistantActive) return
    if (model) this.model = model
    this.finalized = true
    const m = this.model

    const didWork = (m.tools.length > 0) || (m.done?.steps ?? 0) > 0 || (m.findings.length > 0)
    const answer = visibleAssistantText(m.answer)
    const hasAnswer = answer.trim().length > 0
    const hasReasoning = m.reasoning.trim().length > 0

    // Erase live streaming region (tools + answer) and re-render cleanly.
    const totalLiveRows = this.toolLinesWritten + this.liveAnswerRows
    if (totalLiveRows > 0 && this.tty) {
      this.pause?.()
      this.write(ESC.up(totalLiveRows) + ESC.clearDown)
    }
    this.liveAnswerRows = 0
    this.toolLinesWritten = 0

    // ── Re-render answer first — content-forward design ──
    // INVARIANT: reasoning implies answer. An LLM cannot produce reasoning
    // without answer text in the same forward pass. When the answer is
    // missing (budget killed mid-generation, filtered tool-intent), we
    // compose from the reasoning tail — the last 10 lines contain the
    // brain's conclusion. This makes "(no answer)" structurally impossible
    // whenever the brain produced any reasoning at all.
    if (hasAnswer) {
      const rendered = renderMarkdown(answer, { ...this.opts, isTTY: this.tty })
      this.write(rendered + '\n')
    } else if (hasReasoning) {
      const lines = m.reasoning.trim().split('\n').filter(l => l.trim())
      const tail = lines.slice(-10).join('\n').trim()
      if (tail) {
        const rendered = renderMarkdown(tail, { ...this.opts, isTTY: this.tty })
        this.write(rendered + '\n')
      } else {
        this.write(this.c(ESC.dim) + '(no response)' + this.c(ESC.reset) + '\n')
      }
    } else if (!didWork) {
      this.write(this.c(ESC.dim) + '(no response)' + this.c(ESC.reset) + '\n')
    } else {
      const status = m.done?.status ?? (m.complete ? 'done' : 'stopped')
      const reason = status === 'budget_reached' ? 'budget reached'
        : status === 'stale' ? 'no new information'
        : status === 'frontier_exhausted' ? 'frontier exhausted'
        : status === 'interrupted' ? 'interrupted'
        : status
      this.write(this.c(ESC.dim) + `(no answer — ${reason})` + this.c(ESC.reset) + '\n')
    }

    // ── Re-render tool rows ──
    for (const line of this.toolRows.values()) {
      this.write(line + '\n')
    }

    // ── Collapsed / expanded reasoning block ──
    if (this.showReasoning && hasReasoning) {
      const lines = m.reasoning.trim().split('\n').length
      if (this.reasoningExpanded) {
        const body = m.reasoning.trim().split('\n')
          .map((r) => `${this.c(ESC.dim)}${r || ' '}${this.c(ESC.reset)}`)
          .join('\n')
        this.write(body + '\n')
      } else {
        this.write(this.c(ESC.dim) + `reasoning (${lines} lines) — /r to expand` + this.c(ESC.reset) + '\n')
      }
    }

    // ── Findings — severity-colored, inline ──
    if (m.findings.length > 0) {
      for (const f of m.findings) {
        const sevCol = f.severity === 'critical' || f.severity === 'high'
          ? this.c(ESC.red)
          : f.severity === 'medium'
            ? this.c(ESC.yellow)
            : this.c(ESC.cyan)
        const glyph = f.severity === 'critical' || f.severity === 'high'
          ? `${this.c(ESC.red)}✗${this.c(ESC.reset)}`
          : `${this.c(ESC.green)}✓${this.c(ESC.reset)}`
        const where = f.endpoint ? `  ${this.c(ESC.dim)}@ ${f.endpoint}${this.c(ESC.reset)}` : ''
        this.write(`  ${glyph} ${sevCol}${f.severity.toUpperCase()}${this.c(ESC.reset)} ${f.technique}${where}\n`)
      }
    }

    // ── Footer — minimal status line (only for working turns) ──
    if (didWork) {
      const steps = m.done?.steps ?? 0
      const tools = m.tools.length
      const findings = m.findings.length
      const status = m.done?.status ?? (m.complete ? 'done' : 'stopped')
      const duration = m.done?.durationMs ? formatDuration(m.done.durationMs) : ''
      const parts = [status, `${steps} steps`, `${tools} tools`]
      if (findings > 0) parts.push(`${findings} finding${findings > 1 ? 's' : ''}`)
      if (duration) parts.push(duration)
      this.write(this.c(ESC.dim) + `── ${parts.join(' · ')} ──` + this.c(ESC.reset) + '\n')
    }

    // ── System events — only for working turns ──
    if (this.showSystemEvents && didWork && this.sinkBuffer.length) {
      this.flushSinkBlock()
    } else {
      this.sinkBuffer = []
    }

    this.resume?.()
    this.assistantActive = false
  }

  toggleReasoning(): void {
    if (!this.assistantActive) return
    this.reasoningExpanded = !this.reasoningExpanded
  }

  // ───────────────────────────── Activity ─────────────────────────────

  beginActivity(label: string): void {
    if (this.activityActive) this.endActivity('ok')
    this.activityActive = true
    this.activityRows = 0
    const line = `${this.c(ESC.dim)}├─ ⠿ ${label}${this.c(ESC.reset)}`
    this.write(line + '\n')
    this.activityRows = 1
  }

  updateActivity(text: string): void {
    if (!this.activityActive) return
    if (!this.tty) {
      this.write(`${this.c(ESC.dim)}│  ⠿ ${text}${this.c(ESC.reset)}\n`)
      return
    }
    if (this.activityRows > 0) {
      this.write(`\x1b[${this.activityRows}A\x1b[J`)
    }
    const line = `${this.c(ESC.dim)}│  ⠿ ${text}${this.c(ESC.reset)}`
    this.write(line + '\n')
    this.activityRows = 1
  }

  endActivity(status: ActivityStatus = 'ok', detail?: string): void {
    if (!this.activityActive) return
    const glyph = status === 'ok' ? this.c(ESC.green) + '✓'
      : status === 'warn' ? this.c(ESC.yellow) + '?'
      : this.c(ESC.red) + '✗'
    const text = detail
      ? `${this.c(ESC.dim)}└─${this.c(ESC.reset)} ${glyph} ${detail}${this.c(ESC.reset)}`
      : `${glyph}${this.c(ESC.reset)}`
    if (this.tty && this.activityRows > 0) {
      this.write(`\x1b[${this.activityRows}A\x1b[J`)
    }
    this.write(text + '\n')
    this.activityActive = false
    this.activityRows = 0
  }

  // ───────────────────────────── System / misc ─────────────────────────────

  printSystem(text: string, level: 'info' | 'warn' | 'error' | 'success' | 'dim' = 'info'): void {
    const tag = level === 'warn' ? this.c(ESC.yellow) + '? '
      : level === 'error' ? this.c(ESC.red) + '? '
      : level === 'success' ? this.c(ESC.green) + '✔ '
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

  // ───────────────────────────── LogSink ─────────────────────────────

  installSink(): void {
    setLogSink(this.asSink())
    this.sinkInstalled = true
  }

  uninstallSink(): void {
    setLogSink(null)
    this.sinkInstalled = false
    this.sinkBuffer = []
  }

  private asSink(): LogSink {
    return (level: string, msg: string) => {
      if (level === 'nl') return
      const tag = level === 'warn' ? '? '
        : level === 'error' ? '! '
        : ''
      this.sinkBuffer.push(`${this.c(ESC.gray)}[sys] ${tag}${msg}${this.c(ESC.reset)}`)
    }
  }

  private flushSinkBlock(): void {
    if (!this.sinkBuffer.length) return
    this.write(this.c(ESC.dim) + '── system events ──' + this.c(ESC.reset) + '\n')
    for (const line of this.sinkBuffer) this.write(line + '\n')
    this.sinkBuffer = []
  }

  flush(): void {
    if (this.showSystemEvents && this.sinkBuffer.length) {
      this.flushSinkBlock()
    }
  }

  flushSystem(): void {
    if (this.showSystemEvents && this.sinkBuffer.length) {
      this.flushSinkBlock()
    } else {
      this.sinkBuffer = []
    }
  }
}

// ───────────────────────────── Helpers ─────────────────────────────

/**
 * Shape-based tool arg summary. Reads structural fields by key.
 * Never shows raw JSON — returns empty string for unknown shapes.
 */
function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') return ''
  const parts: string[] = []
  const push = (s: string) => { if (s) parts.push(s) }

  // HTTP-style: METHOD URL
  if (typeof args.method === 'string') push(args.method.toUpperCase())
  if (typeof args.url === 'string') {
    try {
      const u = new URL(String(args.url))
      push(u.pathname + (u.search || ''))
    } catch {
      push(String(args.url))
    }
  } else if (typeof args.endpoint === 'string') {
    push(String(args.endpoint))
  } else if (typeof args.query === 'string') {
    push(String(args.query))
  }

  // Skill/technique context
  if (typeof args.severity === 'string') push(`sev:${args.severity}`)
  if (typeof args.technique === 'string') push(String(args.technique))

  // Named targets
  if (!parts.length && typeof args.target === 'string') push(String(args.target))
  if (!parts.length && typeof args.prompt === 'string') {
    const p = String(args.prompt)
    push(p.length > 40 ? p.slice(0, 37) + '…' : p)
  }
  if (!parts.length && typeof args.skillId === 'string') push(String(args.skillId))
  if (!parts.length && typeof args.id === 'string') push(String(args.id))
  if (!parts.length && typeof args.prefix === 'string') push(String(args.prefix))

  const out = parts.join(' ')
  return out.slice(0, 80)
}

/**
 * Shape-based tool result summary. Parses JSON structure to extract
 * human-readable meaning. Never shows raw JSON — returns empty string
 * when no meaningful summary can be extracted.
 */
function summarizeResult(result?: string): string {
  if (!result) return ''

  let parsed: Record<string, unknown> | undefined
  try {
    parsed = JSON.parse(result) as Record<string, unknown>
  } catch {
    // Not JSON — plain text, show truncated
    const preview = result.replace(/\s+/g, ' ').trim()
    return preview.length > 80 ? preview.slice(0, 77) + '…' : preview
  }

  if (!parsed || typeof parsed !== 'object') return ''

  // Extract from Mastra content format: { content: [{ type: "text", text: "..." }] }
  let inner: Record<string, unknown> | undefined
  if (parsed.content) {
    const content = Array.isArray(parsed.content) ? parsed.content[0] : parsed.content
    if (content?.text && typeof content.text === 'string') {
      try { inner = JSON.parse(content.text) as Record<string, unknown> } catch { inner = undefined }
    }
  }
  if (!inner && typeof parsed.text === 'string') {
    try { inner = JSON.parse(parsed.text) as Record<string, unknown> } catch { inner = undefined }
  }
  if (!inner && typeof parsed.result === 'string') {
    try { inner = JSON.parse(parsed.result) as Record<string, unknown> } catch { inner = undefined }
  }

  const obj = inner ?? parsed

  // ── ok/error patterns ──
  if (obj.ok === false || obj.success === false) {
    const err = typeof obj.error === 'string' ? obj.error : typeof obj.message === 'string' ? obj.message : ''
    if (err) return err.length > 80 ? err.slice(0, 77) + '…' : err
    return 'failed'
  }

  // ── Browser tools (success: boolean) ──
  if (obj.success === true) {
    if (typeof obj.title === 'string' && typeof obj.url === 'string') return `loaded "${obj.title}"`
    if (typeof obj.url === 'string') return `navigated`
    if (typeof obj.action === 'string') return obj.action
    if (typeof obj.ariaSnapshot === 'string') return 'observed page'
    if (typeof obj.base64 === 'string') return 'screenshot captured'
    if (Array.isArray(obj.tabs)) return `${obj.tabs.length} tab${obj.tabs.length !== 1 ? 's' : ''}`
    if (typeof obj.remainingTabs === 'number') return `${obj.remainingTabs} tab${obj.remainingTabs !== 1 ? 's' : ''}`
    if (typeof obj.url === 'string') return obj.url
    return 'ok'
  }

  // ── ok: true with message ──
  if (obj.ok === true && typeof obj.message === 'string') {
    return obj.message.length > 80 ? obj.message.slice(0, 77) + '…' : obj.message
  }

  // ── Tool list: { tools: { builtin: [...] } } ──
  if (obj.tools && typeof obj.tools === 'object') {
    const tools = obj.tools as Record<string, unknown>
    let count = 0
    for (const v of Object.values(tools)) {
      if (Array.isArray(v)) count += v.length
    }
    if (count > 0) return `${count} tool${count !== 1 ? 's' : ''}`
  }

  // ── HTTP response: { ok: true, value: { status, url, body, ... } } ──
  const value = obj.value as Record<string, unknown> | undefined
  if (value && typeof value === 'object') {
    if (typeof value.status === 'number') {
      const size = typeof value.body === 'string' ? value.body.length : 0
      const ct = typeof value.headers === 'object' && value.headers
        ? String((value.headers as Record<string, string>)['content-type'] ?? '').split(';')[0]
        : ''
      const parts = [`${value.status}`]
      if (size > 0) parts.push(size > 1024 ? `${Math.round(size / 1024)}KB` : `${size}B`)
      if (ct) parts.push(ct)
      return parts.join(' · ')
    }

    // Array values: count items
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v)) {
        return `${v.length} ${k.replace(/s$/, '')}${v.length !== 1 ? 's' : ''}`
      }
    }

    // String message in value
    if (typeof value.message === 'string') {
      return value.message.length > 80 ? value.message.slice(0, 77) + '…' : value.message
    }
  }

  // ── Top-level arrays ──
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && k !== 'content') {
      return `${v.length} ${k.replace(/s$/, '')}${v.length !== 1 ? 's' : ''}`
    }
  }

  // ── Top-level counts ──
  if (typeof obj.count === 'number') return `${obj.count}`
  if (typeof obj.total === 'number') return `${obj.total}`
  if (typeof obj.introspectionEnabled === 'boolean') {
    return obj.introspectionEnabled ? 'introspection enabled' : 'introspection disabled'
  }

  // Never return raw JSON
  return ''
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
