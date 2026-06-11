import chalk from 'chalk'

type Level = 'info' | 'success' | 'warn' | 'error' | 'dim'

const LEVEL_STYLE: Record<Level, (msg: string) => string> = {
  info: (m) => m,
  success: (m) => chalk.green('✔ ') + m,
  warn: (m) => chalk.yellow('⚠ ') + m,
  error: (m) => chalk.red('✘ ') + m,
  dim: (m) => chalk.dim(m),
}

export class Logger {
  private module?: string

  constructor(module?: string) {
    this.module = module
  }

  child(module: string): Logger {
    return new Logger(module)
  }

  private fmt(level: Level, msg: string): string {
    const tag = this.module ? chalk.dim(`[${this.module}] `) : ''
    return tag + LEVEL_STYLE[level](msg)
  }

  info(msg: string): void {
    console.log(this.fmt('info', msg))
  }

  success(msg: string): void {
    console.log(this.fmt('success', msg))
  }

  warn(msg: string): void {
    console.log(this.fmt('warn', msg))
  }

  error(msg: string): void {
    console.error(this.fmt('error', msg))
  }

  dim(msg: string): void {
    console.log(this.fmt('dim', msg))
  }

  raw(msg: string): void {
    console.log(msg)
  }

  nl(): void {
    console.log('')
  }

  banner(text: string, sub?: string): void {
    this.nl()
    this.raw(chalk.cyan('━'.repeat(47)))
    this.raw(chalk.cyan('  ' + text))
    if (sub) this.raw(chalk.cyan('  ' + sub))
    this.raw(chalk.cyan('━'.repeat(47)))
    this.nl()
  }

  markdown(html: string): void {
    this.raw(html)
  }
}

export const log = new Logger()
