/**
 * Reaction Observer — Accessibility-tree-based detection of UI feedback after agent actions
 *
 * After every browser action (click, fill, navigate, submit), this observer
 * snapshots the page via page.snapshot() (accessibility tree) and diffs it
 * against a pre-action baseline.
 *
 * Detects: modals, toasts, snackbars, error messages, success messages,
 * notifications, content changes, and native dialogs (via dialog-watcher).
 *
 * Uses page.snapshot() (Stagehand V3Page) instead of CSS selectors because:
 * - CSS selectors miss <dialog> elements, shadow DOM, ARIA-only widgets
 * - Accessibility tree captures ALL semantic elements regardless of implementation
 * - Same mechanism screen readers use — ground truth for what's "visible"
 */

import { getActivePage } from './manager'
import { getGlobalDialogWatcher } from './dialog-watcher'

export interface Reaction {
  type: 'modal' | 'toast' | 'snackbar' | 'notification' | 'error' | 'success' | 'dialog' | 'text-change' | 'overlay' | 'new-element' | 'none'
  content: string
  selector?: string
  visible: boolean
  timestamp: number
}

export interface ReactionSnapshot {
  /** Accessibility tree elements (role + text pairs) */
  axElements: AxElement[]
  /** Visible text content (trimmed, normalized) */
  visibleText: string
  /** Active dialog count from dialog-watcher */
  dialogCount: number
  /** URL at snapshot time */
  url: string
  /** Timestamp */
  timestamp: number
}

export interface ReactionResult {
  /** All detected reactions */
  reactions: Reaction[]
  /** Whether anything changed at all */
  hasChanges: boolean
  /** Summary text for injection into agent context */
  summary: string
  /** The pre-action snapshot */
  baseline: ReactionSnapshot | null
  /** The post-action snapshot */
  current: ReactionSnapshot | null
}

export interface AxElement {
  role: string
  text: string
  name?: string
  depth: number
}

const MAX_REACTIONS = 50

/**
 * Parse Stagehand's formattedTree (accessibility tree text) into structured AxElements.
 *
 * Format per line:
 *   <indent>  <role>  "<text>"  [attr=value] ...
 * Example:
 *   root  heading "Welcome" [level=1]
 *     button "Submit"
 *     alert "Error: invalid input"
 *     dialog "Confirm Delete"
 *       button "OK"
 *       button "Cancel"
 */
function parseFormattedTree(tree: string): AxElement[] {
  if (!tree) return []
  const elements: AxElement[] = []
  const lines = tree.split('\n')

  for (const line of lines) {
    if (!line.trim()) continue

    // Count leading spaces for depth
    const stripped = line.replace(/^ */, '')
    const depth = (line.length - stripped.length) / 2

    // Extract role (first word)
    const roleMatch = stripped.match(/^(\S+)/)
    if (!roleMatch) continue
    const role = roleMatch[1]

    // Extract text in quotes: "..."
    const textMatch = stripped.match(/"([^"]*)"/)
    const text = textMatch ? textMatch[1] : ''

    // Extract name after role but before quotes: role name "text"
    const nameMatch = stripped.match(/^\S+\s+(\S+)\s/)
    const name = nameMatch && nameMatch[1] !== `"${text}"` ? nameMatch[1] : undefined

    elements.push({ role, text, name, depth })
  }

  return elements
}

/**
 * Take a snapshot of the current page state via page.snapshot() + dialog-watcher.
 * Falls back to page.evaluate() body.innerText if snapshot() is unavailable.
 */
async function takeSnapshot(page: any): Promise<{ visibleText: string; axElements: AxElement[]; dialogCount: number; url: string }> {
  const dialogWatcher = getGlobalDialogWatcher()
  const dialogCount = dialogWatcher.getDialogs().length
  const url = typeof page.url === 'function' ? page.url() : ''

  let axElements: AxElement[] = []
  let visibleText = ''

  // Primary: page.snapshot() (Stagehand V3Page — accessibility tree)
  if (typeof page.snapshot === 'function') {
    try {
      const snap = await page.snapshot()
      if (snap && typeof snap.formattedTree === 'string') {
        axElements = parseFormattedTree(snap.formattedTree)
        visibleText = snap.formattedTree
      }
    } catch {
      // Fall through to evaluate fallback
    }
  }

  // Fallback: page.evaluate for body.innerText (Playwright or snapshot failure)
  if (!visibleText && typeof page.evaluate === 'function') {
    try {
      visibleText = await page.evaluate(`(function() {
        try { return (document.body.innerText || '').trim().slice(0, 8000); }
        catch(e) { return ''; }
      })()`)
    } catch {
      // Page may be blocked by a dialog — that's fine, dialogCount captures it
    }
  }

  return { visibleText, axElements, dialogCount, url }
}

class ReactionObserver {
  private baseline: ReactionSnapshot | null = null
  private reactions: Reaction[] = []
  private observing = false

  /**
   * Capture a baseline snapshot BEFORE an agent action.
   */
  async captureBaseline(): Promise<ReactionSnapshot | null> {
    const page = getActivePage()
    if (!page) return null

    try {
      const { visibleText, axElements, dialogCount, url } = await takeSnapshot(page)

      this.baseline = {
        visibleText,
        axElements,
        dialogCount,
        url,
        timestamp: Date.now(),
      }

      this.observing = true
      return this.baseline
    } catch {
      return null
    }
  }

  /**
   * Detect reactions AFTER an agent action by diffing against baseline.
   */
  async detectReaction(): Promise<ReactionResult> {
    if (!this.baseline) {
      return { reactions: [], hasChanges: false, summary: '', baseline: null, current: null }
    }

    const page = getActivePage()
    if (!page) {
      return { reactions: [], hasChanges: false, summary: '', baseline: this.baseline, current: null }
    }

    try {
      const { visibleText, axElements, dialogCount, url } = await takeSnapshot(page)

      const current: ReactionSnapshot = {
        visibleText,
        axElements,
        dialogCount,
        url,
        timestamp: Date.now(),
      }

      const reactions: Reaction[] = []

      // 1. Detect new dialogs (from dialog-watcher — native JS dialogs)
      if (current.dialogCount > this.baseline.dialogCount) {
        const dialogWatcher = getGlobalDialogWatcher()
        const recentDialogs = dialogWatcher.getRecentDialogs(5000)
        for (const dialog of recentDialogs) {
          reactions.push({
            type: 'dialog',
            content: `[${dialog.type}] ${dialog.message}`,
            visible: true,
            timestamp: dialog.timestamp,
          })
        }
      }

      // 2. Detect new accessibility tree elements (modals, alerts, toasts, etc.)
      // Diff: find elements in current that aren't in baseline (by role+text)
      const baselineKeys = new Set(
        this.baseline.axElements.map(e => `${e.role}::${e.text}`)
      )

      const newElements = current.axElements.filter(e => !baselineKeys.has(`${e.role}::${e.text}`))

      for (const el of newElements) {
        // Classify by ARIA role
        if (el.role === 'dialog' || el.role === 'alertdialog' || el.role === 'modal') {
          reactions.push({
            type: 'modal',
            content: el.text || `New ${el.role} appeared`,
            visible: true,
            timestamp: Date.now(),
          })
        } else if (el.role === 'alert' || el.role === 'status') {
          // Determine if error or success by content heuristics
          const content = el.text || ''
          const isError = /error|fail|invalid|denied|forbidden|unauthorized/i.test(content)
          const isSuccess = /success|saved|created|updated|deleted|completed|welcome/i.test(content)
          reactions.push({
            type: isError ? 'error' : isSuccess ? 'success' : 'notification',
            content,
            visible: true,
            timestamp: Date.now(),
          })
        } else if (el.role === 'log') {
          reactions.push({
            type: 'notification',
            content: el.text || '',
            visible: true,
            timestamp: Date.now(),
          })
        } else if (el.role === 'button' && el.text) {
          // New buttons appearing can indicate toasts with action buttons
          reactions.push({
            type: 'new-element',
            content: `New button: "${el.text}"`,
            visible: true,
            timestamp: Date.now(),
          })
        }
      }

      // 3. Detect significant text changes (new content appeared)
      const textDiff = this.computeTextDiff(this.baseline.visibleText, current.visibleText)
      if (textDiff.added.length > 0) {
        for (const added of textDiff.added.slice(0, 5)) {
          // Avoid duplicating reactions already captured from accessibility tree
          const isDuplicate = reactions.some(r => r.content.includes(added.slice(0, 50)))
          if (!isDuplicate) {
            reactions.push({
              type: 'text-change',
              content: added,
              visible: true,
              timestamp: Date.now(),
            })
          }
        }
      }

      // 4. Detect URL changes
      if (current.url !== this.baseline.url) {
        reactions.push({
          type: 'new-element',
          content: `Page navigated: ${this.baseline.url} → ${current.url}`,
          visible: true,
          timestamp: Date.now(),
        })
      }

      // Store reactions (cap at MAX_REACTIONS)
      this.reactions.push(...reactions)
      if (this.reactions.length > MAX_REACTIONS) {
        this.reactions = this.reactions.slice(-MAX_REACTIONS)
      }

      // Build summary
      const summary = this.buildSummary(reactions)

      this.baseline = current
      this.observing = false

      return {
        reactions,
        hasChanges: reactions.length > 0,
        summary,
        baseline: this.baseline,
        current,
      }
    } catch {
      this.baseline = null
      this.observing = false
      return { reactions: [], hasChanges: false, summary: '', baseline: this.baseline, current: null }
    }
  }

  /**
   * Get all stored reactions.
   */
  getReactions(): Reaction[] {
    return [...this.reactions]
  }

  /**
   * Get recent reactions from the last N seconds.
   */
  getRecentReactions(sinceMs?: number): Reaction[] {
    if (!sinceMs) return this.getReactions()
    const cutoff = Date.now() - sinceMs
    return this.reactions.filter(r => r.timestamp >= cutoff)
  }

  /**
   * Get a formatted summary string for agent context injection.
   */
  getReactionSummary(): string {
    if (this.reactions.length === 0) return ''
    const recent = this.reactions.slice(-10)
    return recent.map(r => `[${r.type}] ${r.content}`).join('\n')
  }

  /**
   * Clear stored reactions.
   */
  clear(): void {
    this.reactions = []
    this.baseline = null
    this.observing = false
  }

  /**
   * Detach observer — alias for clear().
   */
  detach(): void {
    this.clear()
  }

  isObserving(): boolean {
    return this.observing
  }

  // --- Private helpers ---

  /**
   * Compute text diff between two snapshots — what was added/removed.
   * Uses line-based diffing for efficiency.
   */
  private computeTextDiff(before: string, after: string): { added: string[]; removed: string[] } {
    const beforeLines = new Set(before.split('\n').map(l => l.trim()).filter(l => l.length > 5))
    const afterLines = new Set(after.split('\n').map(l => l.trim()).filter(l => l.length > 5))

    const added: string[] = []
    const removed: string[] = []

    for (const line of afterLines) {
      if (!beforeLines.has(line)) {
        added.push(line)
      }
    }
    for (const line of beforeLines) {
      if (!afterLines.has(line)) {
        removed.push(line)
      }
    }

    return { added, removed }
  }

  /**
   * Build a human-readable summary from detected reactions.
   */
  private buildSummary(reactions: Reaction[]): string {
    if (reactions.length === 0) return ''

    const parts: string[] = []
    const byType = new Map<string, Reaction[]>()

    for (const r of reactions) {
      const existing = byType.get(r.type) || []
      existing.push(r)
      byType.set(r.type, existing)
    }

    for (const [type, items] of byType) {
      switch (type) {
        case 'dialog':
          parts.push(`Dialog(s) appeared: ${items.map(i => i.content).join('; ')}`)
          break
        case 'modal':
          parts.push(`Modal/overlay appeared`)
          break
        case 'toast':
        case 'snackbar':
          parts.push(`${type === 'snackbar' ? 'Snackbar' : 'Toast'}: ${items.map(i => i.content).join('; ')}`)
          break
        case 'error':
          parts.push(`Error: ${items.map(i => i.content).join('; ')}`)
          break
        case 'success':
          parts.push(`Success: ${items.map(i => i.content).join('; ')}`)
          break
        case 'text-change':
          parts.push(`Content changed: ${items.map(i => i.content.slice(0, 100)).join('; ')}`)
          break
        case 'notification':
          parts.push(`Notification: ${items.map(i => i.content).join('; ')}`)
          break
        case 'new-element':
          parts.push(items.map(i => i.content).join('; '))
          break
      }
    }

    return parts.join('\n')
  }
}

let globalObserver: ReactionObserver | null = null

export function getGlobalReactionObserver(): ReactionObserver {
  if (!globalObserver) globalObserver = new ReactionObserver()
  return globalObserver
}

export function resetGlobalReactionObserver(): void {
  if (globalObserver) {
    globalObserver.clear()
    globalObserver = null
  }
}
