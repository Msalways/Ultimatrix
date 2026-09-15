/**
 * ASCII art banner for the hacker terminal REPL.
 */

import { ESC, THEME, BOX, termWidth } from './theme'

const ASCII_LOGO = [
  '███╗   ███╗██╗███╗   ██╗██████╗ ███████╗██████╗ ',
  '████╗ ████║██║████╗  ██║██╔══██╗██╔════╝██╔══██╗',
  '██╔████╔██║██║██╔██╗ ██║██║  ██║█████╗  ██████╔╝',
  '██║╚██╔╝██║██║██║╚██╗██║██║  ██║██╔══╝  ██╔══██╗',
  '██║ ╚═╝ ██║██║██║ ╚████║██████╔╝███████╗██║  ██║',
  '╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═╝',
]

export interface BannerMeta {
  version?: string
  model?: string
  role?: string
  target?: string
  engine?: string
  oast?: string
}

/**
 * Print the ASCII art banner with framed status info.
 * Only prints when stdout is a TTY.
 */
export function printBanner(meta: BannerMeta = {}, tty = true): void {
  if (!tty) return

  const write = (s: string) => process.stdout.write(s)
  const w = termWidth()

  // Logo (dim cyan)
  write('\n')
  for (const line of ASCII_LOGO) {
    write(`  ${ESC.dim}${ESC.cyan}${line}${ESC.reset}\n`)
  }
  write('\n')

  // Status box
  const info: string[] = []
  if (meta.version) info.push(`ver ${meta.version}`)
  if (meta.model && meta.role) info.push(`${meta.role}: ${meta.model}`)
  if (meta.target) info.push(`target: ${meta.target}`)
  if (meta.engine) info.push(`engine: ${meta.engine}`)
  if (meta.oast && meta.oast !== 'deferred') info.push(`oast: ${meta.oast}`)

  if (info.length > 0) {
    const boxWidth = Math.max(...info.map(s => s.length)) + 4
    const hLine = BOX.double.h.repeat(Math.min(boxWidth, w - 4))

    write(`  ${THEME.boxBorder}${BOX.double.tl}${hLine}${BOX.double.tr}${ESC.reset}\n`)
    for (const line of info) {
      const pad = boxWidth - line.length - 2
      write(`  ${THEME.boxBorder}${BOX.double.v}${ESC.reset} ${THEME.boxLabel}${line}${ESC.reset}${' '.repeat(Math.max(0, pad))}${THEME.boxBorder}${BOX.double.v}${ESC.reset}\n`)
    }
    write(`  ${THEME.boxBorder}${BOX.double.bl}${hLine}${BOX.double.br}${ESC.reset}\n`)
  }

  write('\n')
}

/**
 * Print a one-line compact banner for non-TTY / plain mode.
 */
export function printCompactBanner(meta: BannerMeta = {}): void {
  const parts: string[] = ['ULTIMATRIX']
  if (meta.version) parts.push(meta.version)
  if (meta.model) parts.push(meta.model)
  if (meta.target) parts.push(`→ ${meta.target}`)
  process.stdout.write(parts.join(' | ') + '\n')
}
