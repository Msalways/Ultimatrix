import type { Interface } from 'node:readline'

/**
 * Owns a readline interface's input from the moment it is created.
 *
 * Why this exists: `readline.createInterface` begins draining `process.stdin`
 * immediately. With piped input (CI, `echo ... | ultimatrix interact`, scripted
 * runs) the whole buffer is consumed and discarded before any listener is
 * attached, and `close` fires exactly once — so a listener attached later
 * (after engine setup) never sees a line and never sees the close. The REPL then
 * waits forever for input that has already gone. This reproduces in ~5 lines of
 * plain Node with no application code at all.
 *
 * The fix is structural: attach exactly one `line`/`close` pair at creation and
 * queue from then on, so nothing can be lost no matter how long engine setup
 * takes or how long a turn runs. Consumers read from the queue.
 */
export class ReplInputQueue {
  private readonly lines: string[] = []
  private closed = false
  private disposed = false
  private waiter: (() => void) | null = null

  private readonly onLine = (line: string): void => {
    this.lines.push(line)
    this.wake()
  }

  private readonly onClose = (): void => {
    this.closed = true
    this.wake()
  }

  constructor(private readonly rl: Interface) {
    // Attached synchronously in the constructor — this timing is the whole point.
    this.rl.on('line', this.onLine)
    this.rl.on('close', this.onClose)
  }

  private wake(): void {
    const fn = this.waiter
    this.waiter = null
    fn?.()
  }

  /** Next line, or null once the input stream is closed and drained. */
  read(): Promise<string | null> {
    if (this.lines.length > 0) return Promise.resolve(this.lines.shift()!)
    if (this.closed || this.disposed) return Promise.resolve(null)
    return new Promise<string | null>((resolve) => {
      this.waiter = () => resolve(this.lines.length > 0 ? this.lines.shift()! : null)
    })
  }

  /** Lines already received but not yet consumed. */
  pending(): number {
    return this.lines.length
  }

  get isClosed(): boolean {
    return this.closed
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.closed = true
    this.rl.off('line', this.onLine)
    this.rl.off('close', this.onClose)
    this.lines.length = 0
    this.wake()
  }
}
