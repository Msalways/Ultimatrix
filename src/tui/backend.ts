import type { Backend, Cell, Position, Size } from 'terminui'
import { charWidth } from 'terminui'
import { stdout } from 'node:process'

const moveTo = (x: number, y: number): string => `\u001B[${y + 1};${x + 1}H`

function styleKey(cell: Cell): string {
  const fg = cell.fg ? `${cell.fg.type}:${JSON.stringify(cell.fg)}` : 'u'
  const bg = cell.bg ? `${cell.bg.type}:${JSON.stringify(cell.bg)}` : 'u'
  return `${fg}|${bg}|${cell.modifier}`
}

function colorAnsi(color: Cell['fg'], bg: boolean): string {
  if (!color || color.type === 'reset') return bg ? '49' : '39'
  if (color.type === 'indexed') return `${bg ? '48' : '38'};5;${color.index}`
  if (color.type === 'rgb') return `${bg ? '48' : '38'};2;${color.r};${color.g};${color.b}`
  const map: Record<string, [number, number]> = {
    black: [30, 40], red: [31, 41], green: [32, 42], yellow: [33, 43],
    blue: [34, 44], magenta: [35, 45], cyan: [36, 46], gray: [37, 47],
    white: [97, 107],
  }
  const pair = map[color.type]
  return pair ? String(bg ? pair[1] : pair[0]) : bg ? '49' : '39'
}

function styleAnsi(cell: Cell): string {
  const codes = [colorAnsi(cell.fg, false), colorAnsi(cell.bg, true)]
  return `\u001B[0;${codes.join(';')}m`
}

export function createAnsiBackend(): Backend {
  let pending = ''
  let style = ''
  let cursor: Position = { x: 0, y: 0 }

  const write = (chunk: string) => { stdout.write(chunk) }

  return {
    size: (): Size => ({
      width: Math.max(70, stdout.columns ?? 90),
      height: Math.max(18, (stdout.rows ?? 28) - 1),
    }),
    draw: (content) => {
      if (content.length === 0) return
      const sorted = [...content].sort((a, b) => (a.y - b.y) || (a.x - b.x))
      for (const entry of sorted) {
        if (cursor.y !== entry.y || cursor.x !== entry.x) {
          pending += moveTo(entry.x, entry.y)
          cursor = { x: entry.x, y: entry.y }
        }
        const key = styleKey(entry.cell)
        if (key !== style) {
          pending += styleAnsi(entry.cell)
          style = key
        }
        pending += entry.cell.symbol === '' ? ' ' : entry.cell.symbol
        cursor = {
          x: cursor.x + Math.max(1, charWidth(entry.cell.symbol.codePointAt(0) ?? 0)),
          y: cursor.y,
        }
      }
    },
    flush: () => {
      if (pending.length === 0) return
      write(pending)
      pending = ''
    },
    hideCursor: () => write('\u001B[?25l'),
    showCursor: () => write('\u001B[?25h'),
    getCursorPosition: (): Position => cursor,
    setCursorPosition: (pos: Position) => {
      cursor = pos
      write(moveTo(pos.x, pos.y))
    },
    clear: () => {
      write('\u001B[2J\u001B[H')
      style = ''
      cursor = { x: 0, y: 0 }
    },
  }
}
