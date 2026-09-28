/**
 * Interactive REPL input handling.
 *
 * Reproduces the piped-stdin race that made `interact` un-exitable: a command
 * (notably /exit) arriving while a turn is still running was emitted with no
 * listener attached, so it was dropped and the REPL blocked forever waiting for
 * a line that could never arrive. Locked by feeding input while `onInput` is
 * deliberately still pending.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { SessionLifecycle } from '../../src/session/lifecycle'
import { ReplInputQueue } from '../../src/session/repl-input'

/** Minimal readline-shaped double with the real pause/resume/flow semantics. */
class FakeReadline extends EventEmitter {
  paused = false
  private buffer: string[] = []
  closeOnDrain = true
  private closedEmitted = false

  pause() { this.paused = true }
  resume() { this.paused = false; this.drain() }

  /** Feed a line the way a piped stdin would: emit now if flowing, else buffer. */
  feed(line: string) {
    if (this.paused || this.listenerCount('line') === 0) { this.buffer.push(line); return }
    this.emit('line', line)
  }

  /** stdin reached EOF: emit close once no buffered input remains. */
  end() {
    if (this.paused) { this.closeOnDrain = true; return }
    this.drain()
  }

  private drain() {
    if (this.paused) return
    if (this.listenerCount('line') === 0) return
    const next = this.buffer.shift()
    if (next !== undefined) { this.emit('line', next); return }
    if (this.closeOnDrain && !this.closedEmitted) {
      this.closedEmitted = true
      this.emit('close')
    }
  }

  // ReplInputQueue attaches 'line'/'close' synchronously in its constructor, so
  // the double must deliver immediately: there is no "listener attached later"
  // window any more. That window is what ReplInputQueue exists to eliminate.
  override on(event: string, listener: (...args: any[]) => void): this {
    super.on(event, listener)
    if (event === 'line') queueMicrotask(() => this.drain())
    return this
  }

  override once(event: string, listener: (...args: any[]) => void): this {
    super.once(event, listener)
    if (event === 'line') queueMicrotask(() => this.drain())
    return this
  }
}

/** Wait for a condition instead of guessing at module-load timing. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met within timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

function makeLifecycle(rl: FakeReadline) {
  const lifecycle = new SessionLifecycle()
  // The REPL reads through ReplInputQueue (attached at readline creation), so
  // the test double must be wired the same way the runtime wires it.
  const queue = new ReplInputQueue(rl as any)
  ;(lifecycle as any).phase = 'resources'
  ;(lifecycle as any)._resources = {
    config: { engine: 'solver', interaction: {} },
    target: 'https://target.test',
    oastPort: 0,
    readline: rl,
    replInput: queue,
    consoleMode: false,
  }
  // Neutralize the expensive teardown; this test is about input control flow.
  ;(lifecycle as any).cleanup = vi.fn(async () => {})
  return lifecycle
}

describe('interactive REPL input handling', () => {
  it('does not lose a command that arrives while a turn is running', async () => {
    const rl = new FakeReadline()
    const lifecycle = makeLifecycle(rl)

    let releaseTurn: (v: void) => void = () => {}
    const turnInFlight = new Promise<void>((resolve) => { releaseTurn = resolve })

    const seen: string[] = []
    const done = (lifecycle as any).runREPLOwned(async (line: string) => {
      seen.push(line)
      if (line === 'do work') { await turnInFlight; return undefined }
      return false // /exit semantics: end the session
    })

    // First line starts a long turn...
    rl.feed('do work')
    await until(() => seen.length === 1)
    expect(seen).toEqual(['do work'])

    // ...and while that turn is in flight the operator sends /exit, plus EOF.
    rl.feed('/exit')
    rl.end()
    await new Promise((r) => setImmediate(r))

    // Completing the turn must deliver the buffered /exit, not drop it.
    releaseTurn()
    await done

    expect(seen).toEqual(['do work', '/exit'])
  })

  it('still exits on EOF with no further input', async () => {
    const rl = new FakeReadline()
    const lifecycle = makeLifecycle(rl)
    const seen: string[] = []
    const done = (lifecycle as any).runREPLOwned(async (line: string) => {
      seen.push(line)
      return undefined
    })
    rl.feed('hello')
    await until(() => seen.length === 1)
    rl.end()
    await done
    expect(seen).toEqual(['hello'])
  })
})
