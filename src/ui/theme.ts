/**
 * Terminal theme — colors, box-drawing, ESC codes.
 * Single source of truth for all UI modules.
 *
 * Design language: near-black canvas, off-white text, phosphor green accent,
 * cyan for tool execution, red for findings/danger. Inspired by Claude Code
 * and opencode terminal aesthetics.
 */

export const ESC = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
  inverse: '\x1b[7m',
  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  violet: '\x1b[35m', // alias
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  // Cursor
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  // Erase
  eraseLine: '\x1b[2K',
  eraseToEnd: '\x1b[K',
  eraseDown: '\x1b[J',
  clearDown: '\x1b[J',
  clearLine: '\x1b[K',
  // Cursor movement
  up: (n = 1) => n > 0 ? `\x1b[${n}A` : '',
  down: (n = 1) => n > 0 ? `\x1b[${n}B` : '',
  forward: (n = 1) => n > 0 ? `\x1b[${n}C` : '',
  back: (n = 1) => n > 0 ? `\x1b[${n}D` : '',
  cursorToCol0: '\x1b[G',
  saveCursor: '\x1b[s',
  restoreCursor: '\x1b[u',
  // Keep legacy aliases
  cursorUp: (n = 1) => n > 0 ? `\x1b[${n}A` : '',
  cursorDown: (n = 1) => n > 0 ? `\x1b[${n}B` : '',
  cursorForward: (n = 1) => n > 0 ? `\x1b[${n}C` : '',
  cursorBack: (n = 1) => n > 0 ? `\x1b[${n}D` : '',
}

/**
 * Semantic color tokens.
 *
 * Design language: phosphor green for action/success, cyan for tool execution,
 * red for danger/findings, off-white for body text, gray for metadata.
 */
export const THEME = {
  // Primary accent — phosphor green (action, success, active state)
  accent: ESC.green,
  prompt: ESC.bold + ESC.green,
  promptArrow: ESC.bold + ESC.green,
  // Content — off-white body text
  answer: ESC.white,
  thinking: ESC.dim,
  code: ESC.green,
  link: ESC.cyan,
  bold: ESC.bold,
  dim: ESC.dim,
  // Tool execution — cyan (technical, precise)
  toolBorder: ESC.cyan,
  toolName: ESC.bold + ESC.cyan,
  toolMarkOk: ESC.green,
  toolMarkErr: ESC.red,
  toolMarkRunning: ESC.yellow,
  // Findings — red (danger, discovery)
  critical: ESC.bold + ESC.red,
  high: ESC.red,
  medium: ESC.yellow,
  low: ESC.cyan,
  // Status
  ok: ESC.green,
  warn: ESC.yellow,
  err: ESC.red,
  running: ESC.cyan + ESC.dim,
  info: ESC.dim,
  // Box / chrome
  boxBorder: ESC.dim,
  boxLabel: ESC.bold + ESC.white,
  separator: ESC.dim,
  // System
  system: ESC.dim + ESC.gray,
  banner: ESC.bold + ESC.white,
  // ESC reset shorthand
  reset: ESC.reset,
} as const

/** Box-drawing character sets. */
export const BOX = {
  /** Single-line box (tool blocks, summaries). */
  single: {
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    h: '─', v: '│',
  },
  /** Double-line box (banner). */
  double: {
    tl: '╔', tr: '╗', bl: '╚', br: '╝',
    h: '═', v: '║',
  },
  /** Heavy single-line box. */
  heavy: {
    tl: '┏', tr: '┓', bl: '┗', br: '┛',
    h: '━', v: '┃',
  },
  /** Tree connectors for tool lines. */
  tree: {
    branch: '├─',
    last: '└─',
    pipe: '│',
    space: '  ',
  },
} as const

/**
 * Build a dashed border line: - - - - - - - - -
 * Used for the input prompt area (Claude Code signature style).
 */
export function dashedBorder(width?: number): string {
  const w = width ?? Math.min((process.stdout?.columns ?? 80) - 2, 64)
  return '- '.repeat(Math.ceil(w / 2)).slice(0, w)
}

/**
 * Build a box-drawn block with title and lines.
 * Reusable by both init (summary) and interact (findings, status).
 */
export function boxBlock(title: string, lines: string[], tty = true): string {
  const maxLen = Math.max(title.length + 4, ...lines.map(l => stripAnsiLen(l)))
  const w = maxLen + 4
  const b = BOX.single
  const dim = tty ? ESC.dim : ''
  const rst = tty ? ESC.reset : ''
  const result: string[] = []
  result.push(`${dim}${b.tl}${b.h} ${title} ${b.h.repeat(Math.max(0, w - title.length - 3))}${b.tr}${rst}`)
  for (const line of lines) {
    const visLen = stripAnsiLen(line)
    const pad = Math.max(0, maxLen - visLen)
    result.push(`${dim}${b.v}${rst}  ${line}${' '.repeat(pad)}  ${dim}${b.v}${rst}`)
  }
  result.push(`${dim}${b.bl}${b.h.repeat(w - 1)}${b.br}${rst}`)
  return result.join('\n')
}

/** Strip ANSI codes and return visual length. */
function stripAnsiLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length
}

/** Check if stdout is a real terminal. */
export function isTTY(out: { isTTY?: boolean } = process.stdout): boolean {
  return Boolean(out.isTTY)
}

/** Get terminal width (columns). */
export function termWidth(): number {
  return process.stdout?.columns ?? 80
}

/** Conditionally apply ANSI codes (no-op when not a TTY). */
export function c(code: string, tty: boolean): string {
  return tty ? code : ''
}
