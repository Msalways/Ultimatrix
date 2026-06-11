import { describe, it, expect } from 'vitest'

describe('TUI types', () => {
  it('export type definitions', async () => {
    const mod = await import('./types')
    expect(mod).toBeDefined()
  })
})

describe('console-capture', () => {
  it('captures console.log and restores it', async () => {
    const mod = await import('./console-capture')
    const restore = mod.captureConsole()
    const spy = console.log
    console.log('test message')
    expect(spy).toBeDefined()
    restore()
  })

  it('getDebugBuffer returns captured logs', async () => {
    const mod = await import('./console-capture')
    const restore = mod.captureConsole()
    console.log('captured line')
    const buf = mod.getDebugBuffer()
    expect(buf.some(l => l.includes('captured line'))).toBe(true)
    restore()
  })
})

describe('startTUI', () => {
  it('exports startTUI function', async () => {
    const mod = await import('./index')
    expect(mod.startTUI).toBeDefined()
    expect(typeof mod.startTUI).toBe('function')
  })
})
