/**
 * Terminal adapter — paints the shared RenderModel to a TTY.
 *
 * Design rules (from the output/compaction plan):
 *  - TTY-aware: emits ANSI only when stdout is a real terminal; falls back to
 *    plain text when piped/redirected (no raw escape leakage).
 *  - Single owner of terminal formatting: the web UI never imports this file.
 *  - termcn/Ink is the intended rich shell (progress, tables, cards); this
 *    adapter provides a clean, dependency-free baseline that the Ink layer
 *    will wrap. Both consume the same RenderModel.
 */

import { marked, type Token, type Tokens } from 'marked'
import type { RenderModel } from './render-model'

/**
 * NOTE: `marked-terminal@7` is incompatible with `marked@15` (its renderer
 * predates marked v15's renderer API; verified — both the `TerminalRenderer`
 * class and the `markedTerminal()` extension emit plain text under marked@15).
 * Rather than couple the whole project to a downgraded `marked`, we render
 * marked's structured token stream to theme-aware ANSI ourselves. This keeps
 * the green/cyan instrument palette and avoids shipping a broken dependency.
 */

export interface TerminalPaintOptions {
  /** Where to write. Defaults to process.stdout. */
  write?: (s: string) => void
  /** Override TTY detection (tests / forced modes). */
  isTTY?: boolean
  /** Width hint for wrapping. */
  width?: number
  /**
   * Pause the host input line (readline) before cursor manipulation, and
   * resume afterwards. Provided by the REPL so in-place redraw never collides
   * with the user's prompt. No-op-safe in non-interactive (solve) runs.
   */
  pause?: () => void
  /** Resume the host input line after a redraw. */
  resume?: () => void
}

const ESC = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
}

const SEV_COLOR: Record<string, string> = {
  critical: ESC.red,
  high: ESC.red,
  medium: ESC.yellow,
  low: ESC.cyan,
  info: ESC.dim,
}

/** Detect a real terminal (not piped). */
export function isTerminal(out: { isTTY?: boolean } = process.stdout): boolean {
  return Boolean(out.isTTY)
}

/**
 * Render the full model to a string. ANSI only when `tty` is true.
 * The web adapter renders the same model via React — no divergence.
 */
export function renderTerminal(model: RenderModel, opts: TerminalPaintOptions = {}): string {
  const write = opts.write ?? ((s: string) => process.stdout.write(s))
  const tty = opts.isTTY ?? isTerminal()
  const c = (code: string) => (tty ? code : '')
  const lines: string[] = []

  if (model.phase) {
    lines.push(`${c(ESC.dim)}[${model.phase}]${c(ESC.reset)}`)
  }

  if (model.reasoning.trim()) {
    lines.push(`${c(ESC.dim)}⟢ thinking${c(ESC.reset)}`)
    lines.push(c(ESC.dim) + wrap(model.reasoning.trim(), opts.width) + c(ESC.reset))
    lines.push('')
  }

  if (model.answer.trim()) {
    lines.push(wrap(model.answer.trim(), opts.width))
    lines.push('')
  }

  if (model.tools.length) {
    lines.push(`${c(ESC.dim)}tools:${c(ESC.reset)}`)
    for (const t of model.tools) {
      const mark = t.state === 'ok' ? `${c(ESC.green)}✓${c(ESC.reset)}` : t.state === 'err' ? `${c(ESC.red)}✗${c(ESC.reset)}` : `${c(ESC.dim)}…${c(ESC.reset)}`
      lines.push(`  ${mark} ${t.name}`)
    }
    lines.push('')
  }

  if (model.findings.length) {
    lines.push(`${c(ESC.bold)}findings:${c(ESC.reset)}`)
    for (const f of model.findings) {
      const col = SEV_COLOR[f.severity] ?? c(ESC.dim)
      const where = f.endpoint ? ` @ ${f.endpoint}` : ''
      lines.push(`  ${col}${f.severity.toUpperCase()}${c(ESC.reset)} ${f.technique}${where}`)
    }
    lines.push('')
  }

  if (model.complete && model.done) {
    const d = model.done
    lines.push(`${c(ESC.dim)}── done · ${d.steps} steps · ${d.toolCalls} tools · ${d.durationMs}ms · ${d.status}${c(ESC.reset)}`)
  }

  const out = lines.join('\n')
  if (opts.write) write(out)
  return out
}

const FENCE_RE = /```/g

/**
 * Does the buffer contain an UNCLOSED fenced code block?
 * Count of ``` must be odd → the last fence is open.
 */
function hasOpenFence(text: string): boolean {
  const matches = text.match(FENCE_RE)
  return matches !== null && matches.length % 2 === 1
}

/** Index of the opening fence of the last (unclosed) code block, or -1. */
function lastOpenFenceIndex(text: string): number {
  if (!hasOpenFence(text)) return -1
  let idx = -1
  let from = 0
  for (;;) {
    const next = text.indexOf('```', from)
    if (next < 0) break
    idx = next
    from = next + 3
  }
  return idx
}

/** Strip inline markdown emphasis markers for plain-text rendering. */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
}

/**
 * Render a single markdown token to ANSI (TTY) or plain text.
 */
function renderToken(t: Token, tty: boolean): string {
  const c = (code: string) => (tty ? code : '')
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading
      const hashes = '#'.repeat(h.depth)
      if (tty) return `${c(ESC.bold)}${c(ESC.green)}${hashes} ${h.text}${c(ESC.reset)}\n`
      return `${hashes} ${h.text}\n`
    }
    case 'paragraph': {
      const p = t as Tokens.Paragraph
      return `${inlineMd(p.text, tty)}\n`
    }
    case 'text': {
      const tx = t as Tokens.Text
      return `${inlineMd(tx.text, tty)}\n`
    }
    case 'list': {
      const l = t as Tokens.List
      const out: string[] = []
      let n = 1
      for (const item of l.items) {
        const bullet = l.ordered ? `${n}.` : '•'
        out.push(`${bullet} ${inlineMd(item.text.trim(), tty)}`)
        n++
      }
      return out.join('\n') + '\n'
    }
    case 'code': {
      const code = t as Tokens.Code
      const lang = code.lang ? `${c(ESC.dim)}${code.lang}${c(ESC.reset)} ` : ''
      const border = tty ? `${c(ESC.green)}│${c(ESC.reset)} ` : '| '
      const lines = code.text.replace(/\n+$/, '').split('\n')
      const body = lines.map(ln => `${border}${ln}`).join('\n')
      return `${lang}\n${body}\n`
    }
    case 'blockquote': {
      const bq = t as Tokens.Blockquote
      return renderTokens(bq.tokens ?? [], tty).split('\n').map(ln => `> ${ln}`).join('\n') + '\n'
    }
    case 'table': {
      return renderTable(t as Tokens.Table, tty) + '\n'
    }
    case 'hr':
      return tty ? `${c(ESC.dim)}────────────${c(ESC.reset)}\n` : '────────────\n'
    case 'space':
      return '\n'
    default:
      // Unknown token: best-effort plain text.
      return tty ? '' : ''
  }
}

/** Render a table token as a bordered instrument grid. */
function renderTable(t: Tokens.Table, tty: boolean): string {
  const c = (code: string) => (tty ? code : '')
  const cellText = (cell: unknown): string => {
    if (typeof cell === 'string') return cell
    if (cell && typeof cell === 'object' && 'tokens' in (cell as object)) {
      return (cell as { tokens?: Token[] }).tokens?.map(tk => tokenText(tk)).join('') ?? ''
    }
    if (cell && typeof cell === 'object' && 'text' in (cell as object)) {
      return String((cell as { text: unknown }).text)
    }
    return String(cell ?? '')
  }
  const cell = (s: unknown) => stripInline(cellText(s)).replace(/\s+/g, ' ').trim()
  const cols = t.header.map(h => cell(h.text))
  const rows = t.rows.map(r => r.map(cell))
  const width = Math.max(8, ...cols.map(s => s.length), ...rows.flat().map(s => s.length))
  const pad = (s: string) => s.padEnd(width).slice(0, width)
  const sep = tty
    ? `${c(ESC.dim)}+${'-'.repeat(width + 2)}+${c(ESC.reset)}`
    : `+${'-'.repeat(width + 2)}+`
  const line = (cells: string[]) =>
    (tty ? c(ESC.dim) + '| ' + c(ESC.reset) : '| ') +
    cells.map(x => pad(x)).join(tty ? `${c(ESC.reset)} | ${c(ESC.reset)}` : ' | ') +
    (tty ? c(ESC.dim) + ' |' + c(ESC.reset) : ' |')
  const head = `${line(cols)}\n`
  const body = rows.map(r => line(r)).join('\n')
  return `${sep}\n${head}${sep}\n${body}\n${sep}`
}

/** Extract plain text from a token (used for nested table-cell tokens). */
function tokenText(t: Token): string {
  const anyT = t as Record<string, unknown>
  if (typeof anyT.text === 'string') return anyT.text
  if (Array.isArray(anyT.tokens)) return (anyT.tokens as Token[]).map(tokenText).join('')
  if (typeof anyT.raw === 'string') return anyT.raw
  return ''
}

/** Inline markdown: bold, italic, code, links. */
function inlineMd(s: string, tty: boolean): string {
  const c = (code: string) => (tty ? code : '')
  let out = s
  out = out.replace(/\*\*(.+?)\*\*/g, (_m, p) => `${c(ESC.bold)}${p}${c(ESC.reset)}`)
  out = out.replace(/(?<!\*)\*(.+?)\*(?!\*)/g, (_m, p) => `${c(ESC.cyan)}${p}${c(ESC.reset)}`)
  out = out.replace(/`(.+?)`/g, (_m, p) => `${c(ESC.green)}${p}${c(ESC.reset)}`)
  out = out.replace(/\[(.+?)\]\((.+?)\)/g, (_m, txt) => `${c(ESC.cyan)}${txt}${c(ESC.reset)}`)
  return out
}

/** Render an array of tokens. */
function renderTokens(tokens: Token[], tty: boolean): string {
  return tokens.map(t => renderToken(t, tty)).join('')
}

/**
 * Render markdown to a terminal string.
 *  - tty=true  → theme-aware ANSI (bold green headers, green-tinted code box,
 *    bordered table grid, cyan inline emphasis).
 *  - tty=false → plain text (no escape codes).
 *
 * Open-fence fallback: while a fenced block is still open, the tail after the
 * last opening fence is rendered as RAW monospace (no code box) to avoid the
 * half-open-fence flicker seen in naive streaming markdown renderers. This is
 * the same approach opencode / Claude Code use for smooth streaming.
 */
export function renderMarkdown(text: string, opts: TerminalPaintOptions = {}): string {
  const tty = opts.isTTY ?? isTerminal()
  const trimmed = text.replace(/\s+$/, '')

  if (!trimmed.trim()) return ''

  // Open-fence fallback: split at the unclosed fence, render head as markdown,
  // leave the open-fence tail as raw mono.
  const openIdx = tty ? lastOpenFenceIndex(trimmed) : -1
  if (openIdx >= 0) {
    const head = trimmed.slice(0, openIdx).trim()
    const tail = trimmed.slice(openIdx)
    const headRendered = head ? renderTokens(marked.lexer(head), tty) : ''
    return (headRendered + tail).replace(/\n+$/, '\n')
  }

  if (tty) {
    return renderTokens(marked.lexer(trimmed), tty).replace(/\n+$/, '\n')
  }

  // Non-TTY: plain text via marked's default renderer.
  const raw = marked.parse(trimmed) as string
  return raw.replace(/\n+$/, '\n')
}

/** Simple word-wrap respecting width (no ANSI-aware measurement). */
function wrap(text: string, width = 80): string {
  if (!width || width < 20) return text
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= width) {
      out.push(paragraph)
      continue
    }
    let line = ''
    for (const word of paragraph.split(' ')) {
      if ((line + ' ' + word).trim().length > width) {
        out.push(line)
        line = word
      } else {
        line = (line + ' ' + word).trim()
      }
    }
    if (line) out.push(line)
  }
  return out.join('\n')
}

/** Incremental painter: tracks prior model to only emit new deltas. */
export class TerminalStream {
  private prev = { reasoning: 0, answer: 0, tools: 0, findings: 0 }
  constructor(private opts: TerminalPaintOptions = {}) {}

  push(model: RenderModel): void {
    const write = this.opts.write ?? ((s: string) => process.stdout.write(s))
    const tty = this.opts.isTTY ?? isTerminal()

    const newReasoning = model.reasoning.slice(this.prev.reasoning)
    const newAnswer = model.answer.slice(this.prev.answer)
    if (newReasoning && tty) write(`${ESC.dim}${newReasoning}${ESC.reset}`)
    else if (newReasoning) write(newReasoning)
    if (newAnswer) write(newAnswer)

    if (model.tools.length > this.prev.tools) {
      for (let i = this.prev.tools; i < model.tools.length; i++) {
        const t = model.tools[i]
        if (t.state === 'start') write(`${ESC.dim}  → ${t.name}${ESC.reset}\n`)
      }
    }
    if (model.findings.length > this.prev.findings) {
      for (let i = this.prev.findings; i < model.findings.length; i++) {
        const f = model.findings[i]
        const col = SEV_COLOR[f.severity] ?? ESC.dim
        write(`${col}  ${f.severity.toUpperCase()} ${f.technique}${ESC.reset}\n`)
      }
    }
    if (model.complete && this.prev.findings === 0 && model.findings.length === 0 && model.done) {
      write(`${ESC.dim}── done · ${model.done.steps} steps · ${model.done.status}${ESC.reset}\n`)
    }

    this.prev = {
      reasoning: model.reasoning.length,
      answer: model.answer.length,
      tools: model.tools.length,
      findings: model.findings.length,
    }
  }

  final(model: RenderModel): void {
    if (!model.complete) this.push(model)
  }
}

/**
 * Markdown-aware incremental painter.
 *
 * Reasoning and answer are rendered as MARKDOWN with the streaming pattern:
 *  - each delta re-renders the accumulated buffer via `renderMarkdown`,
 *  - an open (unclosed) code fence renders its tail as raw mono (no flicker),
 *  - a blinking caret `▊` marks the live tail while streaming,
 *  - on `done` a final clean re-render is emitted (caret removed).
 *
 * Evidence ledger glyphs (✓/⚠/✗/◆) and the phase rail stay structured — they
 * are NOT part of the markdown prose (co-relation preserved).
 */
export class MarkdownStream {
  private prev = { tools: 0, findings: 0 }
  /** Number of terminal lines the current live (prose) region occupies. */
  private liveLines = 0
  constructor(private opts: TerminalPaintOptions = {}) {}

  private get write(): (s: string) => void {
    return this.opts.write ?? ((s: string) => process.stdout.write(s))
  }

  private get tty(): boolean {
    return this.opts.isTTY ?? isTerminal()
  }

  /** Erase the current live region so it can be redrawn in place. */
  private eraseLive(): void {
    if (this.liveLines === 0) return
    // Move cursor to the start of the live region, clearing each line downward.
    // \x1b[<n>F : cursor up n lines to column 0; \x1b[J : clear to end of screen.
    this.write(`\x1b[${this.liveLines}F\x1b[J`)
    this.liveLines = 0
  }

  /** Compose the live (prose) region as a single string; return [text, lineCount]. */
  private composeLive(model: RenderModel): [string, number] {
    const tty = this.tty
    const parts: string[] = []
    if (model.reasoning.trim()) {
      const rendered = renderMarkdown(model.reasoning, { ...this.opts, isTTY: tty })
      parts.push(`${tty ? ESC.dim : ''}⟢ thinking${tty ? ESC.reset : ''}\n${rendered}`)
    }
    if (model.answer.trim()) {
      parts.push(renderMarkdown(model.answer, { ...this.opts, isTTY: tty }))
    }
    let body = parts.join('\n')
    if (!body) return ['', 0]
    const caret = tty && !model.complete ? `${ESC.dim}▊${ESC.reset}` : ''
    body = `${body}${caret}\n`
    const width = this.opts.width ?? (typeof process !== 'undefined' ? process.stdout?.columns : undefined) ?? 80
    return [body, countVisualRows(body, width)]
  }

  push(model: RenderModel): void {
    const write = this.write
    const tty = this.tty

    // Non-TTY (piped): no cursor control — append prose deltas + events plainly.
    if (!tty) {
      this.pushPlain(model)
      return
    }

    const pause = this.opts.pause
    const resume = this.opts.resume
    try {
      if (pause) pause()

      // 1. Erase the live region so permanent events land above fresh prose.
      this.eraseLive()

      // 2. Emit any new tool / finding lines permanently (above the live region).
      if (model.tools.length > this.prev.tools) {
        for (let i = this.prev.tools; i < model.tools.length; i++) {
          const t = model.tools[i]
          if (t.state === 'start') write(`${ESC.dim}  → ${t.name}${ESC.reset}\n`)
        }
      }
      if (model.findings.length > this.prev.findings) {
        this.emitFindings(model, this.prev.findings)
      }

      // 3. Redraw the live prose region in place.
      const [body, lines] = this.composeLive(model)
      if (body) write(body)
      this.liveLines = lines

      this.prev = { tools: model.tools.length, findings: model.findings.length }
    } finally {
      if (resume) resume()
    }
  }

  /** Non-TTY append-only path (piped output must stay escape-free). */
  private pushPlain(model: RenderModel): void {
    const write = this.write
    const [body] = this.composeLive(model)
    if (body) write(body)
    if (model.tools.length > this.prev.tools) {
      for (let i = this.prev.tools; i < model.tools.length; i++) {
        const t = model.tools[i]
        if (t.state === 'start') write(`  -> ${t.name}\n`)
      }
    }
    if (model.findings.length > this.prev.findings) {
      for (let i = this.prev.findings; i < model.findings.length; i++) {
        const f = model.findings[i]
        write(`  ${f.severity.toUpperCase()} ${f.technique}\n`)
      }
    }
    this.prev = { tools: model.tools.length, findings: model.findings.length }
  }

  /** Emit any findings from `from`..length (permanent, above the live region). */
  private emitFindings(model: RenderModel, from: number): void {
    const write = this.write
    for (let i = from; i < model.findings.length; i++) {
      const f = model.findings[i]
      const col = (SEV_COLOR[f.severity] ?? ESC.dim)
      const glyph = col === ESC.red ? '✗' : '✓'
      write(`${col}  ${glyph} ${f.severity.toUpperCase()} ${f.technique}${ESC.reset}\n`)
    }
  }

  final(model: RenderModel): void {
    const write = this.write
    const tty = this.tty
    if (!model.complete) {
      this.push(model)
      return
    }

    if (!tty) {
      // Plain final frame.
      if (model.findings.length > this.prev.findings) this.emitFindings(model, this.prev.findings)
      if (model.reasoning.trim()) write(`⟢ thinking\n${renderMarkdown(model.reasoning, { ...this.opts, isTTY: false })}\n`)
      if (model.answer.trim()) write(`${renderMarkdown(model.answer, { ...this.opts, isTTY: false })}\n`)
      if (model.done) write(`-- done · ${model.done.steps} steps · ${model.done.toolCalls} tools · ${model.done.status}\n`)
      this.prev.findings = model.findings.length
      return
    }

    const pause = this.opts.pause
    const resume = this.opts.resume
    try {
      if (pause) pause()
      // Erase live region and re-render one final clean frame (caret removed).
      this.eraseLive()
      // Findings are permanent — emit any not yet shown, above the live region.
      if (model.findings.length > this.prev.findings) this.emitFindings(model, this.prev.findings)
      this.prev.findings = model.findings.length
      const [body, lines] = this.composeLive({ ...model, complete: true })
      if (body) write(body)
      this.liveLines = lines
      if (model.done) {
        write(`${ESC.dim}── done · ${model.done.steps} steps · ${model.done.toolCalls} tools · ${model.done.status}${ESC.reset}\n`)
      }
    } finally {
      if (resume) resume()
    }
  }
}

/** Count the number of terminal lines a rendered string occupies. */
function _countLines(s: string): number {
  if (!s) return 0
  // Count newlines; a trailing newline means the cursor sits on a fresh line.
  let n = 0
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++
  return n
}

/**
 * Count the number of VISUAL terminal rows a rendered string occupies, accounting
 * for wrapping at `width`. A single `\n`-separated line longer than `width` wraps
 * onto multiple rows. This is what cursor-up erases must match — raw `\n` counts
 * under-erase on wrapped lines, leaving stale duplicate frames (the old
 * "doubled ⟢ thinking" bug). Pure arithmetic, no escape parsing.
 */
export function countVisualRows(s: string, width = 80): number {
  if (!s) return 0
  let rows = 0
  for (const rawLine of s.split('\n')) {
    const line = stripAnsi(rawLine)
    if (line.length === 0) {
      rows += 1
    } else if (width > 0) {
      rows += Math.ceil(line.length / width)
    } else {
      rows += 1
    }
  }
  return rows
}

/** Remove ANSI escape sequences (for visual-length measurement only). */
function stripAnsi(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b') {
      // Skip until the terminating byte (0x40–0x7E) of the escape sequence.
      let j = i + 1
      while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++
      i = j
    } else {
      out += s[i]
    }
  }
  return out
}
