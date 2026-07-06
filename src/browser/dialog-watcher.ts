/**
 * Dialog Watcher — CDP-level detection of browser-native dialogs
 *
 * Detects alert(), confirm(), prompt() via Chrome DevTools Protocol.
 * Auto-dismisses dialogs so the page doesn't block, and records them
 * as evidence for the agent (especially useful for XSS proof-of-concept).
 *
 * Stagehand v3 is CDP-native (not Playwright), so page.on('dialog') doesn't work.
 * Instead, we hook into the CDP Session's event system for Page.javascriptDialogOpening.
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

class DialogWatcher {
  private dialogs: DialogEvent[] = [];
  private attached = false;
  private browser: any = null;
  private cleanupFns: Array<() => void> = [];

  /**
   * Attach to a StagehandBrowser instance.
   * Hooks into CDP events to detect and auto-dismiss native dialogs.
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
      const conn = (context as any).conn;
      if (!conn) {
        log.dim("[dialog-watcher] CDP connection not available");
        return;
      }

      // Listen for new targets (pages/tabs) being attached
      const onTargetAttached = (params: any) => {
        if (params.type === "page" && params.sessionId) {
          this.wireDialogHandler(
            conn,
            params.sessionId,
            params.targetInfo?.url || "",
          );
        }
      };

      // CDP connection level events
      if (typeof conn.on === "function") {
        conn.on("Target.attachedToTarget", onTargetAttached);
        this.cleanupFns.push(() => {
          if (typeof conn.off === "function")
            conn.off("Target.attachedToTarget", onTargetAttached);
        });
      }

      // Also try to attach to already-open pages
      this.wireExistingPages(context, conn);

      this.attached = true;
      log.dim("[dialog-watcher] Active — monitoring for native dialogs");
    } catch (err) {
      log.dim(
        `[dialog-watcher] Failed to attach: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Wire dialog handler to a specific CDP session (page).
   *
   * Uses conn.getSession(sessionId) to get the CdpSession, then registers
   * session.on("Page.javascriptDialogOpening", handler) which fires with (params).
   *
   * CdpConnection dispatches events by CDP method name:
   *   - Events WITH sessionId → session.dispatch(method, params)
   *   - Events WITHOUT sessionId → connection-level handlers
   * Page.javascriptDialogOpening always has a sessionId → must use session-level listener.
   */
  private wireDialogHandler(
    conn: any,
    sessionId: string,
    pageUrl: string,
  ): void {
    try {
      // Get the CdpSession from the connection
      const session = typeof conn.getSession === "function"
        ? conn.getSession(sessionId)
        : undefined;

      if (!session || typeof session.on !== "function") return;

      // Enable Page domain on this session to receive dialog events
      if (typeof session.send === "function") {
        session.send("Page.enable").catch(() => {});
      }

      // Register for the specific CDP event — handler receives (params)
      const onDialog = (params: any) => {
        this.handleDialog(params, session, pageUrl);
      };
      session.on("Page.javascriptDialogOpening", onDialog);
      this.cleanupFns.push(() => {
        if (typeof session.off === "function") {
          session.off("Page.javascriptDialogOpening", onDialog);
        }
      });
      log.dim(`[dialog-watcher] Wired session ${sessionId.slice(0, 8)}... for dialog events`);
    } catch (err) {
      // Best-effort — some CDP connections don't support session-targeted sends
    }
  }

  /**
   * Wire into already-open pages via the context.
   *
   * Uses session.on("Page.javascriptDialogOpening", handler) on the CdpSession
   * obtained from page.getSessionForFrame(mainFrameId). The handler receives (params)
   * matching CdpSession.dispatch(event, params) signature.
   */
  private wireExistingPages(context: any, conn: any): void {
    try {
      const pages = typeof context.pages === "function" ? context.pages() : (context.pages || []);
      for (const page of pages) {
        const mainFrameId =
          typeof page.mainFrameId === "function" ? page.mainFrameId() : null;
        if (!mainFrameId) continue;

        const session =
          typeof page.getSessionForFrame === "function"
            ? page.getSessionForFrame(mainFrameId)
            : null;
        if (!session || typeof session.on !== "function") continue;

        const sessionId = typeof session.id === "string"
          ? session.id
          : typeof session.id === "function"
            ? session.id()
            : "";
        if (!sessionId) continue;

        // Enable Page domain on this session to receive dialog events
        if (typeof session.send === "function") {
          session.send("Page.enable").catch(() => {});
        }

        // Register for the specific CDP event — handler receives (params)
        const onDialog = (params: any) => {
          this.handleDialog(params, session, page.url?.() || "");
        };
        session.on("Page.javascriptDialogOpening", onDialog);
        this.cleanupFns.push(() => {
          if (typeof session.off === "function") {
            session.off("Page.javascriptDialogOpening", onDialog);
          }
        });
        log.dim(`[dialog-watcher] Wired existing page ${page.url?.() || "unknown"} for dialog events`);
      }
    } catch (err) {
      // Best-effort
    }
  }

  /**
   * Handle a detected dialog — auto-dismiss and record it.
   */
  private handleDialog(
    params: any,
    session: any,
    pageUrl: string,
  ): void {
    const dialog: DialogEvent = {
      type: params.type || "alert",
      message: params.message || "",
      url: pageUrl,
      timestamp: Date.now(),
      defaultValue: params.defaultValue,
    };

    // Store (cap at MAX_STORED_DIALOGS)
    this.dialogs.push(dialog);
    if (this.dialogs.length > MAX_STORED_DIALOGS) {
      this.dialogs = this.dialogs.slice(-MAX_STORED_DIALOGS);
    }

    log.info(
      `Dialog detected: [${dialog.type}] "${dialog.message}" on ${dialog.url}`,
    );

    // Auto-dismiss via CDP — use session.send() (correct CdpSession API)
    try {
      if (typeof session?.send === "function") {
        const dismissParams = {
          accept: true,  // Required parameter to dismiss the dialog
          ...(params.type === "prompt" ? { promptText: "" } : {})
        };
        session.send("Page.handleJavaScriptDialog", dismissParams).catch((err: unknown) => {
          log.dim(`[dialog-watcher] Dismiss failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } catch (err) {
      // Best-effort dismiss
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
