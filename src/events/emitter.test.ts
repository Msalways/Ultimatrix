import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getGlobalEmitter,
  emitActivityStart,
  emitActivityComplete,
  emitActivityError,
  emitFinding,
  emitGraphUpdate,
  emitSpiderProgress,
  emitRecorderInteraction,
  TypedEventEmitter,
} from './emitter'

describe('TypedEventEmitter', () => {
  let emitter: TypedEventEmitter

  beforeEach(() => {
    emitter = new TypedEventEmitter()
  })

  it('emit and on for activity events', () => {
    const listener = vi.fn()
    emitter.on('activity:start', listener)
    emitter.emit('activity:start', { worker: 'injection', task: 'test xss' })
    expect(listener).toHaveBeenCalledWith({ worker: 'injection', task: 'test xss' })
  })

  it('emit and on for finding events', () => {
    const listener = vi.fn()
    emitter.on('finding', listener)
    emitter.emit('finding', { technique: 'xss', severity: 'high', endpoint: '/search' })
    expect(listener).toHaveBeenCalledWith({ technique: 'xss', severity: 'high', endpoint: '/search' })
  })

  it('emit and on for spider events', () => {
    const listener = vi.fn()
    emitter.on('spider:progress', listener)
    emitter.emit('spider:progress', { url: 'http://test.com/page', status: 200 })
    expect(listener).toHaveBeenCalledWith({ url: 'http://test.com/page', status: 200 })
  })

  it('emit and on for graph update events', () => {
    const listener = vi.fn()
    emitter.on('graph:update', listener)
    emitter.emit('graph:update', { action: 'upsertPage', nodeType: 'Page' })
    expect(listener).toHaveBeenCalledWith({ action: 'upsertPage', nodeType: 'Page' })
  })

  it('emit and on for recorder interaction events', () => {
    const listener = vi.fn()
    emitter.on('recorder:interaction', listener)
    emitter.emit('recorder:interaction', { type: 'click', description: 'clicked button' })
    expect(listener).toHaveBeenCalledWith({ type: 'click', description: 'clicked button' })
  })

  it('once works only once', () => {
    const listener = vi.fn()
    emitter.once('activity:start', listener)
    emitter.emit('activity:start', { worker: 'w1', task: 't1' })
    emitter.emit('activity:start', { worker: 'w2', task: 't2' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ worker: 'w1', task: 't1' })
  })

  it('off removes specific listener', () => {
    const listener = vi.fn()
    emitter.on('activity:start', listener)
    emitter.emit('activity:start', { worker: 'w1', task: 't1' })
    emitter.off('activity:start', listener)
    emitter.emit('activity:start', { worker: 'w2', task: 't2' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('removeAllListeners without arg removes all', () => {
    const l1 = vi.fn()
    const l2 = vi.fn()
    emitter.on('activity:start', l1)
    emitter.on('finding', l2)
    emitter.removeAllListeners()
    emitter.emit('activity:start', { worker: 'w1', task: 't1' })
    emitter.emit('finding', { technique: 'xss', severity: 'high', endpoint: '/x' })
    expect(l1).not.toHaveBeenCalled()
    expect(l2).not.toHaveBeenCalled()
  })

  it('removeAllListeners with event removes only that event', () => {
    const l1 = vi.fn()
    const l2 = vi.fn()
    emitter.on('activity:start', l1)
    emitter.on('finding', l2)
    emitter.removeAllListeners('activity:start')
    emitter.emit('activity:start', { worker: 'w1', task: 't1' })
    emitter.emit('finding', { technique: 'xss', severity: 'high', endpoint: '/x' })
    expect(l1).not.toHaveBeenCalled()
    expect(l2).toHaveBeenCalledTimes(1)
  })

  it('emit returns boolean', () => {
    const result = emitter.emit('activity:start', { worker: 'w1', task: 't1' })
    expect(typeof result).toBe('boolean')
  })
})

describe('getGlobalEmitter', () => {
  it('returns singleton', () => {
    const e1 = getGlobalEmitter()
    const e2 = getGlobalEmitter()
    expect(e1).toBe(e2)
  })
})

describe('helper functions', () => {
  beforeEach(() => {
    // Reset listeners
    getGlobalEmitter().removeAllListeners()
  })

  it('emitActivityStart emits activity:start', () => {
    const listener = vi.fn()
    getGlobalEmitter().on('activity:start', listener)
    emitActivityStart('recon', 'scanning')
    expect(listener).toHaveBeenCalledWith({ worker: 'recon', task: 'scanning' })
  })

  it('emitActivityComplete emits activity:complete', () => {
    const listener = vi.fn()
    getGlobalEmitter().on('activity:complete', listener)
    emitActivityComplete('recon', 'done')
    expect(listener).toHaveBeenCalledWith({ worker: 'recon', result: 'done' })
  })

  it('emitActivityError emits activity:error', () => {
    const listener = vi.fn()
    getGlobalEmitter().on('activity:error', listener)
    emitActivityError('injection', 'timeout')
    expect(listener).toHaveBeenCalledWith({ worker: 'injection', error: 'timeout' })
  })

  it('emitFinding emits finding', () => {
    const listener = vi.fn()
    getGlobalEmitter().on('finding', listener)
    emitFinding('sqli', 'critical', '/api/login')
    expect(listener).toHaveBeenCalledWith({ technique: 'sqli', severity: 'critical', endpoint: '/api/login' })
  })

  it('emitGraphUpdate emits graph:update', () => {
    const listener = vi.fn()
    getGlobalEmitter().on('graph:update', listener)
    emitGraphUpdate('addNode', 'Finding')
    expect(listener).toHaveBeenCalledWith({ action: 'addNode', nodeType: 'Finding' })
  })

  it('emitSpiderProgress emits spider:progress', () => {
    const listener = vi.fn()
    getGlobalEmitter().on('spider:progress', listener)
    emitSpiderProgress('http://test.com/page', 200)
    expect(listener).toHaveBeenCalledWith({ url: 'http://test.com/page', status: 200 })
  })

  it('emitRecorderInteraction emits recorder:interaction', () => {
    const listener = vi.fn()
    getGlobalEmitter().on('recorder:interaction', listener)
    emitRecorderInteraction('click', 'clicked #btn')
    expect(listener).toHaveBeenCalledWith({ type: 'click', description: 'clicked #btn' })
  })
})
