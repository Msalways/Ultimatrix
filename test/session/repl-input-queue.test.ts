/**
 * ReplInputQueue — owns stdin from the moment readline is created.
 *
 * Root cause locked here (reproduces in plain Node with no app code): a
 * readline interface drains piped stdin immediately and fires `close` exactly
 * once. A listener attached even ~200ms later sees no line and no close, so a
 * REPL that attaches its listeners after engine setup blocks forever. The queue
 * attaches synchronously at construction, so nothing can be lost.
 */
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { ReplInputQueue } from '../../src/session/repl-input'

class FakeRl extends EventEmitter {
  off = EventEmitter.prototype.off
}

describe('ReplInputQueue', () => {
  it('buffers lines that arrive before the consumer starts reading', async () => {
    const rl = new FakeRl()
    const queue = new ReplInputQueue(rl as any)

    // Simulate piped stdin draining immediately after construction, long before
    // the REPL is ready (this is the exact window that used to lose input).
    rl.emit('line', 'first question')
    rl.emit('line', '/exit')

    expect(queue.pending()).toBe(2)
    expect(await queue.read()).toBe('first question')
    expect(await queue.read()).toBe('/exit')
  })

  it('resolves EOF exactly once after the buffer drains', async () => {
    const rl = new FakeRl()
    const queue = new ReplInputQueue(rl as any)

    rl.emit('line', 'hello')
    rl.emit('close')

    expect(await queue.read()).toBe('hello')
    expect(await queue.read()).toBeNull()
    expect(await queue.read()).toBeNull()
  })

  it('delivers a line that arrives while a read is already pending', async () => {
    const rl = new FakeRl()
    const queue = new ReplInputQueue(rl as any)

    const pending = queue.read()
    rl.emit('line', 'late arrival')
    expect(await pending).toBe('late arrival')
  })

  it('unblocks a pending read on close', async () => {
    const rl = new FakeRl()
    const queue = new ReplInputQueue(rl as any)

    const pending = queue.read()
    rl.emit('close')
    expect(await pending).toBeNull()
  })

  it('stops listening after dispose', async () => {
    const rl = new FakeRl()
    const queue = new ReplInputQueue(rl as any)
    queue.dispose()
    expect(rl.listenerCount('line')).toBe(0)
    expect(rl.listenerCount('close')).toBe(0)
    expect(await queue.read()).toBeNull()
  })
})
