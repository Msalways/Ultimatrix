import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Logger, setLogSink, setPinoLogger, getLogSink } from '../../src/utils/logger'

describe('logger: sink is the authoritative chokepoint', () => {
  const realConsoleLog = console.log
  const realConsoleError = console.error

  beforeEach(() => {
    console.log = vi.fn()
    console.error = vi.fn()
    setPinoLogger(null as any)
    setLogSink(null)
  })

  afterEach(() => {
    console.log = realConsoleLog
    console.error = realConsoleError
    setPinoLogger(null as any)
    setLogSink(null)
  })

  it('routes through the sink even when a Pino logger is installed', () => {
    // Simulate the real CLI: Pino is set, but an interactive turn installs a sink.
    setPinoLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any)
    const sink = vi.fn()
    setLogSink(sink)

    const log = new Logger('test')
    log.info('hello')
    log.warn('careful')
    log.error('boom')

    // Sink received everything; Pino + console were bypassed.
    expect(sink).toHaveBeenCalledWith('info', 'hello', 'test')
    expect(sink).toHaveBeenCalledWith('warn', 'careful', 'test')
    expect(sink).toHaveBeenCalledWith('error', 'boom', 'test')
  })

  it('falls back to Pino when no sink is installed', () => {
    const pino = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any
    setPinoLogger(pino)
    const log = new Logger('test')
    log.info('via pino')
    expect(pino.info).toHaveBeenCalledWith('via pino', {})
  })

  it('restores default console logging when sink is cleared', () => {
    const sink = vi.fn()
    setLogSink(sink)
    new Logger('t').info('buffered')
    expect(sink).toHaveBeenCalledWith('info', 'buffered', 't')
    setLogSink(null)
    new Logger('t').info('unbuffered')
    expect(console.log).toHaveBeenCalled()
  })

  it('getLogSink returns the active sink', () => {
    expect(getLogSink()).toBeNull()
    const sink = vi.fn()
    setLogSink(sink)
    expect(getLogSink()).toBe(sink)
  })
})
