/**
 * Dialog Watcher — JS interceptor for browser-native dialogs
 *
 * Detects alert(), confirm(), prompt() via a JS interceptor injected into
 * every page via V3Context.addInitScript(). This is the standard mechanism
 * (same approach Playwright/Puppeteer use internally).
 *
 * The interceptor:
 * 1. Wraps window.alert/confirm/prompt to record dialog events
 * 2. Auto-accepts every dialog so the page never blocks
 * 3. Stores events in window.__ULTIMATRIX_DIALOGS__ for polling
 *
 * Stagehand v3 is CDP-native — page.on('dialog') doesn't exist.
 * addInitScript() runs the interceptor on every new document load.
 * For the current page, we inject via page.evaluate().
 */

import { log } from "../utils/logger";

export interface DialogEvent {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  url: string;
  timestamp: number;
  defaultValue?: string;
}

export interface DialogWatcherResult {
  dialogs: DialogEvent[];
  count: number;
}

const MAX_STORED_DIALOGS = 100;

/**
 * JS interceptor — injected via addInitScript and page.evaluate.
 * Wraps window.alert/confirm/prompt to capture + auto-accept dialogs.
 */
const INTERCEPTOR_SCRIPT = `(function() {
  if (window.__ULTIMATRIX_DIALOG_INTERCEPTOR) return;
  window.__ULTIMATRIX_DIALOG_INTERCEPTOR = true;
  window.__ULTIMATRIX_DIALOGS__ = [];

  function record(type, args) {
    window.__ULTIMATRIX_DIALOGS__.push({
      type: type,
      message: String(args[0] || ''),
      defaultValue: type === 'prompt' ? String(args[1] || '') : undefined,
      url: location.href,
      timestamp: Date.now(),
    });
  }

  var _alert = window.alert;
  window.alert = function() { record('alert', arguments); };
  window.confirm = function(msg) { record('confirm', arguments); return true; };
  window.prompt = function(msg, def) { record('prompt', arguments); return def || ''; };

  if (typeof MutationObserver !== 'undefined') {
    var origDialog = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function() {
      record('alert', [this.textContent || 'dialog']);
      return origDialog.apply(this, arguments);
    };
  }
})()`;

class DialogWatcher {
  private dialogs: DialogEvent[] = [];
  private attached = false;
  private browser: any = null;
  private cleanupFns: Array<() => void> = [];

  /**
   * Attach to a StagehandBrowser instance.
   * Injects JS interceptor via V3Context.addInitScript() so every page
   * auto-records + auto-accepts native dialogs.
   */
  attach(browser: any): void {
    if (this.attached) return;
    this.browser = browser;

    try {
      const stagehand = browser.requireStagehand?.();
      if (!stagehand?.context) {
        log.dim("[dialog-watcher] Stagehand context not available");
        return;
      }

      const context = stagehand.context;

      // Register interceptor for all future document loads
      if (typeof context.addInitScript === "function") {
        context.addInitScript(INTERCEPTOR_SCRIPT).catch((err: unknown) => {
          log.dim(`[dialog-watcher] addInitScript failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      // Inject into currently loaded pages
      const pages = typeof context.pages === "function" ? context.pages() : [];
      for (const page of pages) {
        if (typeof page.evaluate === "function") {
          page.evaluate(INTERCEPTOR_SCRIPT).catch(() => {});
        }
      }

      this.attached = true;
      log.dim("[dialog-watcher] Active — JS interceptor injected for native dialogs");
    } catch (err) {
      log.dim(
        `[dialog-watcher] Failed to attach: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Read intercepted dialogs from a specific page's window.__ULTIMATRIX_DIALOGS__
   * and merge them into the watcher's store. Clears the page's array after reading.
   */
  async readInterceptedDialogs(page: any): Promise<DialogEvent[]> {
    if (!page || typeof page.evaluate !== "function") return [];

    try {
      const raw: any[] = await page.evaluate(
        `(function() {
          var d = window.__ULTIMATRIX_DIALOGS__ || [];
          window.__ULTIMATRIX_DIALOGS__ = [];
          return d;
        })()`,
      );

      if (!Array.isArray(raw) || raw.length === 0) return [];

      const events: DialogEvent[] = raw.map((d: any) => ({
        type: d.type || "alert",
        message: d.message || "",
        url: d.url || page.url?.() || "",
        timestamp: d.timestamp || Date.now(),
        defaultValue: d.defaultValue,
      }));

      // Merge into watcher store
      for (const event of events) {
        this.dialogs.push(event);
        log.info(
          `Dialog detected: [${event.type}] "${event.message}" on ${event.url}`,
        );
      }

      // Cap at MAX_STORED_DIALOGS
      if (this.dialogs.length > MAX_STORED_DIALOGS) {
        this.dialogs = this.dialogs.slice(-MAX_STORED_DIALOGS);
      }

      return events;
    } catch {
      return [];
    }
  }

  /**
   * Inject the interceptor script into a specific page (for newly created tabs).
   */
  async injectIntoPage(page: any): Promise<void> {
    if (!page || typeof page.evaluate !== "function") return;
    try {
      await page.evaluate(INTERCEPTOR_SCRIPT);
    } catch {
      // Best-effort
    }
  }

  /**
   * Get all captured dialogs.
   */
  getDialogs(): DialogEvent[] {
    return [...this.dialogs];
  }

  /**
   * Get recent dialogs from the last N seconds.
   */
  getRecentDialogs(sinceMs?: number): DialogEvent[] {
    if (!sinceMs) return this.getDialogs();
    const cutoff = Date.now() - sinceMs;
    return this.dialogs.filter((d) => d.timestamp >= cutoff);
  }

  /**
   * Get a formatted summary for injection into agent context.
   */
  getDialogSummary(): string {
    if (this.dialogs.length === 0) return "";
    const recent = this.dialogs.slice(-10);
    return recent
      .map((d) => `[${d.type}] "${d.message}" at ${d.url}`)
      .join("\n");
  }

  /**
   * Check if any XSS-relevant dialogs were detected (alert with JS payload content).
   */
  hasXSSEvidence(): boolean {
    return this.dialogs.some(
      (d) =>
        d.type === "alert" &&
        (d.message.includes("XSS") ||
          d.message.includes("alert") ||
          d.message.includes("<script") ||
          /onerror|onload|onfocus/i.test(d.message)),
    );
  }

  /**
   * Clear stored dialogs.
   */
  clear(): void {
    this.dialogs = [];
  }

  /**
   * Detach all listeners.
   */
  detach(): void {
    for (const cleanup of this.cleanupFns) {
      try {
        cleanup();
      } catch {}
    }
    this.cleanupFns = [];
    this.attached = false;
    this.browser = null;
  }

  isAttached(): boolean {
    return this.attached;
  }
}

let globalWatcher: DialogWatcher | null = null;

export function getGlobalDialogWatcher(): DialogWatcher {
  if (!globalWatcher) globalWatcher = new DialogWatcher();
  return globalWatcher;
}

export function startDialogWatcher(browser: any): DialogWatcher {
  const watcher = getGlobalDialogWatcher();
  watcher.attach(browser);
  return watcher;
}

export function stopDialogWatcher(): void {
  if (globalWatcher) {
    globalWatcher.detach();
    globalWatcher = null;
  }
}
