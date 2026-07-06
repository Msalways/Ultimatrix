/**
 * Reaction Observer — DOM-level detection of UI feedback after agent actions
 *
 * After every browser action (click, fill, navigate, submit), this observer
 * snapshots the DOM state and diffs it against a pre-action baseline.
 * Detects: modals, toasts, snackbars, error messages, success messages,
 * notifications, content changes, and native dialogs (via dialog-watcher).
 *
 * The goal: the agent should never have to guess what happened after an action.
 * The system automatically observes and reports reactions.
 */

import { getActivePage } from './manager'
import { getGlobalDialogWatcher, type DialogEvent } from './dialog-watcher'
import { log } from '../utils/logger'

export interface Reaction {
  type: 'modal' | 'toast' | 'snackbar' | 'notification' | 'error' | 'success' | 'dialog' | 'text-change' | 'overlay' | 'new-element' | 'none'
  content: string
  selector?: string
  visible: boolean
  timestamp: number
}

export interface ReactionSnapshot {
  /** Visible text content (trimmed, normalized) */
  visibleText: string
  /** Count of visible overlay/modal elements */
  overlayCount: number
  /** Contents of common toast/notification containers */
  toastTexts: string[]
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

const MAX_REACTIONS = 50

/**
 * JavaScript to inject into the page to capture DOM state.
 * Returns a normalized snapshot of the current page state.
 */
const SNAPSHOT_SCRIPT = `(function() {
  var result = {
    visibleText: '',
    overlayCount: 0,
    toastTexts: [],
    visibleModals: [],
    visibleErrors: [],
    visibleSuccesses: [],
    notifications: [],
    newAlertElements: [],
  };

  // 1. Visible text — body.innerText (excludes hidden elements)
  try {
    result.visibleText = (document.body.innerText || '').trim().slice(0, 5000);
  } catch(e) {}

  // 2. Overlay/modal count
  var overlaySelectors = [
    '.modal', '.modal-overlay', '.modal-backdrop', '[role="dialog"]',
    '.overlay', '.popup', '.lightbox', '.drawer',
    '[aria-modal="true"]', '.modal.show', '.modal.active',
  ];
  for (var i = 0; i < overlaySelectors.length; i++) {
    try {
      var els = document.querySelectorAll(overlaySelectors[i]);
      for (var j = 0; j < els.length; j++) {
        var style = window.getComputedStyle(els[j]);
        if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
          result.overlayCount++;
          break;
        }
      }
    } catch(e) {}
  }

  // 3. Toast/notification containers
  var toastSelectors = [
    '.toast', '.snackbar', '.notification', '.toaster', '.toast-container',
    '[role="alert"]', '.alert', '.alert-dismissible',
    '.toast-message', '.snackbar-message', '.notification-message',
    '.react-toastify', '.notyf', '.noty', '.toastr',
    '[data-toast]', '[data-notification]',
  ];
  for (var i = 0; i < toastSelectors.length; i++) {
    try {
      var els = document.querySelectorAll(toastSelectors[i]);
      for (var j = 0; j < els.length; j++) {
        var style = window.getComputedStyle(els[j]);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          var text = (els[j].innerText || '').trim();
          if (text && text.length > 0 && text.length < 500) {
            result.toastTexts.push(text);
          }
        }
      }
    } catch(e) {}
  }

  // 4. Error messages
  var errorSelectors = [
    '.error', '.error-message', '.error-text', '.error-alert',
    '.alert-danger', '.alert-error', '.text-danger', '.text-error',
    '[role="alert"].error', '.has-error', '.field-error',
    '.validation-error', '.form-error', '.server-error',
  ];
  for (var i = 0; i < errorSelectors.length; i++) {
    try {
      var els = document.querySelectorAll(errorSelectors[i]);
      for (var j = 0; j < els.length; j++) {
        var style = window.getComputedStyle(els[j]);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          var text = (els[j].innerText || '').trim();
          if (text && text.length > 0 && text.length < 500) {
            result.visibleErrors.push(text);
          }
        }
      }
    } catch(e) {}
  }

  // 5. Success messages
  var successSelectors = [
    '.success', '.success-message', '.success-alert',
    '.alert-success', '.text-success', '.toast-success',
    '[data-success]', '.flash-success', '.is-success',
  ];
  for (var i = 0; i < successSelectors.length; i++) {
    try {
      var els = document.querySelectorAll(successSelectors[i]);
      for (var j = 0; j < els.length; j++) {
        var style = window.getComputedStyle(els[j]);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          var text = (els[j].innerText || '').trim();
          if (text && text.length > 0 && text.length < 500) {
            result.visibleSuccesses.push(text);
          }
        }
      }
    } catch(e) {}
  }

  // 6. General notification elements
  var notifSelectors = [
    '.notification', '.notify', '.message', '.banner',
    '.flash-message', '.flash-notice', '.flash-alert',
    '[role="status"]', '[role="log"]',
  ];
  for (var i = 0; i < notifSelectors.length; i++) {
    try {
      var els = document.querySelectorAll(notifSelectors[i]);
      for (var j = 0; j < els.length; j++) {
        var style = window.getComputedStyle(els[j]);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          var text = (els[j].innerText || '').trim();
          if (text && text.length > 0 && text.length < 500) {
            result.notifications.push(text);
          }
        }
      }
    } catch(e) {}
  }

  return result;
})()`

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
      const domState = await page.evaluate(SNAPSHOT_SCRIPT)
      const dialogWatcher = getGlobalDialogWatcher()
      const dialogCount = dialogWatcher.getDialogs().length

      this.baseline = {
        visibleText: domState.visibleText || '',
        overlayCount: domState.overlayCount || 0,
        toastTexts: domState.toastTexts || [],
        dialogCount,
        url: page.url?.() || '',
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
      const domState = await page.evaluate(SNAPSHOT_SCRIPT)
      const dialogWatcher = getGlobalDialogWatcher()
      const dialogCount = dialogWatcher.getDialogs().length

      const current: ReactionSnapshot = {
        visibleText: domState.visibleText || '',
        overlayCount: domState.overlayCount || 0,
        toastTexts: domState.toastTexts || [],
        dialogCount,
        url: page.url?.() || '',
        timestamp: Date.now(),
      }

      const reactions: Reaction[] = []

      // Detect new dialogs (from dialog-watcher)
      if (current.dialogCount > this.baseline.dialogCount) {
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

      // Detect new modals/overlays
      if (current.overlayCount > this.baseline.overlayCount) {
        reactions.push({
          type: 'modal',
          content: `New overlay/modal appeared (count: ${current.overlayCount}, was: ${this.baseline.overlayCount})`,
          visible: true,
          timestamp: Date.now(),
        })
      }

      // Detect new toasts/snackbars
      const newToasts = current.toastTexts.filter(t => !this.baseline!.toastTexts.includes(t))
      for (const toast of newToasts) {
        const isSnackbar = /snack|bar/i.test(toast)
        reactions.push({
          type: isSnackbar ? 'snackbar' : 'toast',
          content: toast,
          visible: true,
          timestamp: Date.now(),
        })
      }

      // Detect new error messages
      const baselineErrors = this.extractErrors(this.baseline.visibleText)
      const currentErrors = this.extractErrors(current.visibleText)
      const newErrors = currentErrors.filter(e => !baselineErrors.includes(e))
      for (const error of newErrors) {
        reactions.push({
          type: 'error',
          content: error,
          visible: true,
          timestamp: Date.now(),
        })
      }

      // Detect new success messages
      const baselineSuccesses = this.extractSuccesses(this.baseline.visibleText)
      const currentSuccesses = this.extractSuccesses(current.visibleText)
      const newSuccesses = currentSuccesses.filter(s => !baselineSuccesses.includes(s))
      for (const success of newSuccesses) {
        reactions.push({
          type: 'success',
          content: success,
          visible: true,
          timestamp: Date.now(),
        })
      }

      // Detect significant text changes (new content appeared)
      const textDiff = this.computeTextDiff(this.baseline.visibleText, current.visibleText)
      if (textDiff.added.length > 0) {
        for (const added of textDiff.added.slice(0, 5)) {
          // Avoid duplicating errors/successes/toasts already captured
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

      // Detect URL changes
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
   * Extract error-like text from visible text using common patterns.
   */
  private extractErrors(text: string): string[] {
    const errorPatterns = [
      /error[:\s]+(.{10,200})/gi,
      /failed[:\s]+(.{10,200})/gi,
      /invalid[:\s]+(.{10,200})/gi,
      /denied[:\s]+(.{10,200})/gi,
      /unauthorized[:\s]+(.{10,200})/gi,
      /forbidden[:\s]+(.{10,200})/gi,
    ]
    const errors: string[] = []
    for (const pattern of errorPatterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        errors.push(match[0].trim().slice(0, 200))
      }
    }
    return errors
  }

  /**
   * Extract success-like text from visible text using common patterns.
   */
  private extractSuccesses(text: string): string[] {
    const successPatterns = [
      /success[:\s]+(.{10,200})/gi,
      /saved[:\s]+(.{10,200})/gi,
      /created[:\s]+(.{10,200})/gi,
      /updated[:\s]+(.{10,200})/gi,
      /deleted[:\s]+(.{10,200})/gi,
      /completed[:\s]+(.{10,200})/gi,
      /welcome[:\s]+(.{10,200})/gi,
    ]
    const successes: string[] = []
    for (const pattern of successPatterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        successes.push(match[0].trim().slice(0, 200))
      }
    }
    return successes
  }

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
