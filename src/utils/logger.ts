import chalk from 'chalk'
import { PinoLogger } from '@mastra/loggers'

type Level = 'info' | 'success' | 'warn' | 'error' | 'dim'

const LEVEL_STYLE: Record<Level, (msg: string) => string> = {
  info: (m) => m,
  success: (m) => chalk.green('✔ ') + m,
  warn: (m) => chalk.yellow('⚠ ') + m,
  error: (m) => chalk.red('✘ ') + m,
  dim: (m) => chalk.dim(m),
}

let _pino: PinoLogger | null = null

export function setPinoLogger(pino: PinoLogger): void {
  _pino = pino
}

/**
 * Log sink — a single chokepoint for all Logger output. Default sink writes to
 * the real console (normal behavior). During an interactive turn the caller can
 * install a sink that buffers lines so the solver's answer isn't buried under
 * `INFO [ts]` noise; the buffer is flushed above the turn card afterwards.
 * No-op-safe: clearing the sink restores the default console behavior (used by
 * `ultimatrix solve` and the `--plain` fallback).
 */
export type LogSink = (level: string, msg: string, module?: string) => void

let _sink: LogSink | null = null

export function setLogSink(sink: LogSink | null): void {
  _sink = sink
}

export function getLogSink(): LogSink | null {
  return _sink
}

export class Logger {
  private module?: string

  constructor(module?: string) {
    this.module = module
  }

  child(module: string): Logger {
    return new Logger(module)
  }

  private pino(): PinoLogger | null {
    return _pino ? (_pino as unknown as PinoLogger).child?.({ module: this.module }) ?? _pino : null
  }

  private fmt(level: Level, msg: string): string {
    const tag = this.module ? chalk.dim(`[${this.module}] `) : ''
    return tag + LEVEL_STYLE[level](msg)
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    if (_sink) { _sink('info', msg, this.module); return }
    const p = this.pino()
    if (p) { p.info(msg, meta ?? {}); return }
    console.log(this.fmt('info', msg))
  }

  success(msg: string, meta?: Record<string, unknown>): void {
    if (_sink) { _sink('success', msg, this.module); return }
    const p = this.pino()
    if (p) { p.info(msg, meta ?? {}); return }
    console.log(this.fmt('success', msg))
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    if (_sink) { _sink('warn', msg, this.module); return }
    const p = this.pino()
    if (p) { p.warn(msg, meta ?? {}); return }
    console.log(this.fmt('warn', msg))
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    if (_sink) { _sink('error', msg, this.module); return }
    const p = this.pino()
    if (p) { p.error(msg, meta ?? {}); return }
    console.error(this.fmt('error', msg))
  }

  dim(msg: string): void {
    if (_sink) { _sink('dim', msg, this.module); return }
    console.log(this.fmt('dim', msg))
  }

  raw(msg: string): void {
    if (_sink) { _sink('info', msg, this.module); return }
    console.log(msg)
  }

  nl(): void {
    if (_sink) { _sink('nl', '', this.module); return }
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
