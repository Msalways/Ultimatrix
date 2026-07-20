/**
 * Shared contract between the session runtime (lifecycle.ts spider / REPL) and
 * the active terminal surface. `ChatBox` (legacy ANSI) and `UiActivity` (Ink
 * store adapter) both implement this, so the runtime does not depend on either
 * concrete renderer — swapping the console is a one-line change in `main()`.
 */

export interface BannerInfo {
  version: string
  model: string
  target?: string
  engine?: string
}

export interface ActivitySink {
  /** Print the session banner at startup. */
  printBanner(info: BannerInfo): void
  /** Print a system-level message (info/dim). */
  printSystem(msg: string, level?: 'info' | 'dim' | 'warn' | 'error'): void
  /** Print a help block. */
  printHelp(text: string): void
  /** Print a report result line. */
  printReport(text: string): void
  /** Begin a crawl / long-running activity line. */
  beginActivity(label: string): void
  /** Update the live activity line with progress text. */
  updateActivity(text: string): void
  /** End the activity line. */
  endActivity(status?: 'ok' | 'err'): void
  /** Flush any buffered output below the current block. */
  flushSystem(): void
}
