// src/hunt/recorder/behavioral-recorder.ts
//
// BehavioralRecorder subscribes to Playwright page events and turns each
// observable event into a BehavioralStep. Every step is also appended
// to a JSONL file for crash-safe post-hoc replay.
//
// This is a pure observer — it never mutates the page, never blocks
// navigation, never throws out of event handlers. Failed step
// serializations are logged and dropped.

import { randomUUID } from 'node:crypto';
import type { Page, Request, Response, Frame, ConsoleMessage, Dialog } from 'playwright';
import { JsonlWriter } from './jsonl-writer';
import type {
  BehavioralStep,
  BehavioralStepType,
  NavigatePayload,
  ClickPayload,
  FillPayload,
  RequestPayload,
  ResponsePayload,
  RedirectPayload,
  NotificationPayload,
  ConsolePayload,
  ErrorPayload,
  StatePayload,
  EvaluatePayload,
} from './step-types';

export interface BehavioralRecorderOptions {
  jsonlPath: string;
  sessionId: string;
  tabId: string;
  /** Whether to capture request/response bodies (4kb preview). Disable for noisy APIs. */
  captureResponseBodies?: boolean;
  /** Whether to capture console messages. Default true. */
  captureConsole?: boolean;
  /** Whether to capture DOM mutations. Default true. */
  captureMutations?: boolean;
}

type StepListener = (step: BehavioralStep) => void;

export class BehavioralRecorder {
  private opts: BehavioralRecorderOptions;
  private writer: JsonlWriter;
  private listeners: Set<StepListener> = new Set();
  private stepCount = 0;
  private activePage: Page | null = null;
  private pendingRequests: Map<string, Request> = new Map();
  private lastUrl: string = '';
  private mutationObserverHandle: { stop: () => void } | null = null;

  constructor(opts: BehavioralRecorderOptions) {
    this.opts = {
      captureResponseBodies: true,
      captureConsole: true,
      captureMutations: true,
      ...opts,
    };
    this.writer = new JsonlWriter(opts.jsonlPath);
  }

  attach(page: Page): void {
    if (this.activePage) throw new Error('BehavioralRecorder already attached');
    this.activePage = page;
    this.lastUrl = page.url();

    page.on('framenavigated', (frame: Frame) => this.onFrameNavigated(frame));
    page.on('request', (req: Request) => this.onRequest(req));
    page.on('response', (res: Response) => this.onResponse(res));
    page.on('console', (msg: ConsoleMessage) => this.onConsole(msg));
    page.on('pageerror', (err: Error) => this.onPageError(err));
    page.on('dialog', (dlg: Dialog) => this.onDialog(dlg));
    page.on('requestfailed', (req: Request) => this.onRequestFailed(req));
    if (this.opts.captureMutations) {
      this.startMutationObserver(page);
    }
  }

  detach(): void {
    if (this.mutationObserverHandle) {
      this.mutationObserverHandle.stop();
      this.mutationObserverHandle = null;
    }
    this.activePage = null;
    this.pendingRequests.clear();
    this.writer.close();
  }

  onStep(listener: StepListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recordEvaluate(script: string, result: unknown): BehavioralStep {
    const data: EvaluatePayload = { script, result };
    return this.makeStep('evaluate', data);
  }

  recordClick(selector: string, text?: string, beforeHtml?: string, afterHtml?: string): BehavioralStep {
    const data: ClickPayload = { selector, text, beforeHtml, afterHtml };
    return this.makeStep('click', data);
  }

  recordFill(selector: string, value: string, isPassword: boolean): BehavioralStep {
    const data: FillPayload = { selector, value, isPassword };
    return this.makeStep('fill', data);
  }

  recordNavigate(url: string, method: 'spa' | 'hard', referrer?: string): BehavioralStep {
    const data: NavigatePayload = { url, method, referrer };
    return this.makeStep('navigate', data);
  }

  recordState(before: string, after: string, kind: StatePayload['kind']): BehavioralStep {
    const data: StatePayload = { before, after, kind };
    return this.makeStep('state', data);
  }

  recordRedirect(from: string, to: string, trigger: RedirectPayload['trigger'], statusCode?: number): BehavioralStep {
    const data: RedirectPayload = { from, to, trigger, statusCode };
    return this.makeStep('redirect', data);
  }

  recordScreenshot(label: string, path: string, width: number, height: number, fullPage: boolean, sizeBytes: number): BehavioralStep {
    const data: import('./step-types').ScreenshotPayload = { label, path, width, height, fullPage, sizeBytes };
    return this.makeStep('screenshot', data);
  }

  getStepCount(): number {
    return this.stepCount;
  }

  getJsonlPath(): string {
    return this.writer.getPath();
  }

  // --- internal ---

  private makeStep(type: BehavioralStepType, data: unknown): BehavioralStep {
    const step: BehavioralStep = {
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      url: this.lastUrl,
      tabId: this.opts.tabId,
      sessionId: this.opts.sessionId,
      data,
      evidenceRefs: [],
    };
    this.stepCount += 1;
    try {
      this.writer.append(step);
    } catch {
      // Swallow disk errors; the in-memory listener still gets the step.
    }
    for (const listener of this.listeners) {
      try {
        listener(step);
      } catch {
        // Swallow listener errors; one bad listener doesn't break the others.
      }
    }
    return step;
  }

  private onFrameNavigated(frame: Frame): void {
    if (frame !== (this.activePage as unknown as { mainFrame: () => Frame }).mainFrame()) return;
    const url = frame.url();
    const method: 'spa' | 'hard' = url === this.lastUrl ? 'hard' : 'spa';
    const referrer = this.lastUrl || undefined;
    this.lastUrl = url;
    this.makeStep('navigate', { url, method, referrer });
  }

  private onRequest(req: Request): void {
    if (req.resourceType() === 'websocket') return;
    this.pendingRequests.set(req.url() + ':' + Date.now(), req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers())) headers[k.toLowerCase()] = v;
    const data: RequestPayload = {
      method: req.method(),
      url: req.url(),
      headers,
      body: req.postData() ?? undefined,
      resourceType: req.resourceType(),
      initiator: undefined,
    };
    this.makeStep('request', data);
  }

  private async onResponse(res: Response): Promise<void> {
    if (res.request().resourceType() === 'websocket') return;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers())) headers[k.toLowerCase()] = v;
    let bodyPreview = '';
    let bodySize = 0;
    const contentType = headers['content-type'] ?? '';
    if (this.opts.captureResponseBodies && contentType.includes('text') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('javascript')) {
      try {
        const buf = await res.body().catch(() => null);
        if (buf) {
          bodySize = buf.length;
          bodyPreview = buf.toString('utf8', 0, Math.min(buf.length, 4096));
        }
      } catch {
        // ignore
      }
    }
    const data: ResponsePayload = {
      url: res.url(),
      status: res.status(),
      statusText: res.statusText(),
      headers,
      bodyPreview,
      bodySize,
      contentType,
      latencyMs: 0,
      fromCache: false,
    };
    this.makeStep('response', data);
  }

  private onConsole(msg: ConsoleMessage): void {
    if (!this.opts.captureConsole) return;
    const location = msg.location();
    const data: ConsolePayload = {
      level: msg.type() as ConsolePayload['level'],
      text: msg.text(),
      location: location ? { url: location.url, lineNumber: location.lineNumber, columnNumber: location.columnNumber } : undefined,
    };
    this.makeStep('console', data);
  }

  private onPageError(err: Error): void {
    const data: ErrorPayload = {
      kind: 'js',
      message: err.message,
      stack: err.stack,
    };
    this.makeStep('error', data);
  }

  private onDialog(dlg: Dialog): void {
    const data: NotificationPayload = {
      kind: 'dialog',
      text: dlg.message(),
      hasInput: dlg.type() === 'prompt',
      hasActions: dlg.type() === 'confirm',
    };
    this.makeStep('notification', data);
  }

  private onRequestFailed(req: Request): void {
    const data: ErrorPayload = {
      kind: 'network',
      message: req.failure()?.errorText ?? 'request failed',
      url: req.url(),
    };
    this.makeStep('error', data);
  }

  private startMutationObserver(page: Page): void {
    // Best-effort: set up a MutationObserver in-page to catch significant DOM changes.
    // We use page.evaluate to install the observer and route events through a
    // window-level dispatcher. For testability, this is a soft-fail; the
    // recorder still works without it.
    void page
      .evaluate(() => {
        const w = window as unknown as { __huntMutationQueue?: unknown[] };
        w.__huntMutationQueue = [];
        const obs = new MutationObserver((mutations) => {
          for (const m of mutations) {
            const sig =
              m.type === 'childList' ? Math.min(m.addedNodes.length + m.removedNodes.length, 10) / 10
              : m.type === 'attributes' ? 0.3
              : 0.4;
            if (sig < 0.3) continue;
            const target = m.target as Element;
            w.__huntMutationQueue!.push({
              kind: m.type === 'childList' ? (m.addedNodes.length > 0 ? 'added' : 'removed') : m.type === 'attributes' ? 'attrs-changed' : 'text-changed',
              selector: target.tagName ? target.tagName.toLowerCase() : 'unknown',
              attribute: (m as MutationRecord).attributeName ?? undefined,
              significance: sig,
            });
          }
        });
        obs.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        (window as unknown as { __huntMutationObserver: MutationObserver }).__huntMutationObserver = obs;
      })
      .catch(() => {
        // ignore
      });
    this.mutationObserverHandle = {
      stop: () => {
        void page.evaluate(() => {
          const w = window as unknown as { __huntMutationObserver?: MutationObserver; __huntMutationQueue?: unknown[] };
          if (w.__huntMutationObserver) {
            w.__huntMutationObserver.disconnect();
          }
          // Drain queue.
          const queue = w.__huntMutationQueue ?? [];
          w.__huntMutationQueue = [];
          (window as unknown as { __huntMutationDrained?: unknown[] }).__huntMutationDrained = queue;
        }).catch(() => {
          // ignore
        });
      },
    };
  }

  async drainMutations(): Promise<Array<{ kind: string; selector: string; attribute?: string; significance: number }>> {
    if (!this.activePage) return [];
    return this.activePage.evaluate(() => {
      const w = window as unknown as { __huntMutationDrained?: unknown[]; __huntMutationQueue?: unknown[] };
      const drained = w.__huntMutationDrained ?? [];
      w.__huntMutationDrained = [];
      return drained as Array<{ kind: string; selector: string; attribute?: string; significance: number }>;
    }).catch(() => []);
  }
}
