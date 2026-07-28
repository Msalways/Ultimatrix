/**
 * Stub types for the disabled termcn/Ink TUI.
 * The full TUI source is retained on disk but unreferenced.
 */
export interface ActivitySink {
  beginActivity(label: string): void
  updateActivity(text: string): void
  endActivity(status?: 'ok' | 'warn' | 'err', detail?: string): void
}
