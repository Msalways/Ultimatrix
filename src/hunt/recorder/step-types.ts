// src/hunt/recorder/step-types.ts
//
// BehavioralStep is the unit of behavioral capture. Every observable
// event on the page (user interaction, network, DOM mutation, console,
// storage, redirect, error, etc.) becomes a step. The recorder
// subscribes to Playwright page events and emits steps.
//
// The 15 step kinds are exhaustive for the menace loop — anything
// an end-user would notice in a real pentest, captured faithfully.

/** Discriminator union. Add new kinds by extending this union + payload map. */
export type BehavioralStepType =
  | 'navigate'      // page navigation (full or SPA route)
  | 'click'         // element click
  | 'fill'          // form field fill
  | 'request'       // outgoing HTTP request (fetch/XHR)
  | 'response'      // HTTP response (status, headers, body)
  | 'redirect'      // URL change without explicit nav (location.href, meta, 3xx)
  | 'notification'  // toast/alert/banner/modal/dialog
  | 'console'       // console.log/warn/error/info
  | 'storage'       // localStorage/sessionStorage/cookie change
  | 'mutation'      // significant DOM mutation (added/removed/attrs)
  | 'error'         // JS error, network error, CSP violation
  | 'state'         // URL params/hash/history.pushState change
  | 'wait'          // explicit or implicit wait
  | 'screenshot'    // captured screenshot
  | 'evaluate';     // LLM-driven page.evaluate

export interface NavigatePayload {
  url: string;
  method: 'spa' | 'hard';
  referrer?: string;
}

export interface ClickPayload {
  selector: string;
  text?: string;
  beforeHtml?: string;
  afterHtml?: string;
}

export interface FillPayload {
  selector: string;
  value: string;
  /** True if the value matches a password field name (masked in output). */
  isPassword: boolean;
}

export interface RequestPayload {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  resourceType: string; // 'fetch' | 'xhr' | 'document' | 'script' | 'stylesheet' | 'image' | 'font' | 'media' | 'other'
  initiator?: string;
}

export interface ResponsePayload {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyPreview: string;  // first 4kb
  bodySize: number;
  contentType: string;
  latencyMs: number;
  /** True if the response was served from cache. */
  fromCache: boolean;
}

export interface RedirectPayload {
  from: string;
  to: string;
  trigger: 'location' | 'meta' | '3xx' | 'js';
  statusCode?: number;
}

export interface NotificationPayload {
  kind: 'toast' | 'alert' | 'banner' | 'modal' | 'dialog' | 'snackbar';
  text: string;
  durationMs?: number;
  hasInput?: boolean;
  hasActions?: boolean;
}

export interface ConsolePayload {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';
  text: string;
  location?: { url: string; lineNumber: number; columnNumber: number };
}

export interface StoragePayload {
  kind: 'localStorage' | 'sessionStorage' | 'cookie';
  op: 'set' | 'delete' | 'clear';
  key?: string;
  value?: string;
}

export interface MutationPayload {
  kind: 'added' | 'removed' | 'attrs-changed' | 'text-changed';
  selector: string;
  attribute?: string;
  before?: string;
  after?: string;
  /** Significance score from 0-1. */
  significance: number;
}

export interface ErrorPayload {
  kind: 'js' | 'network' | 'csp' | 'cors' | 'mixed-content' | 'webgl';
  message: string;
  source?: string;
  stack?: string;
  url?: string;
}

export interface StatePayload {
  kind: 'url-params' | 'hash' | 'history';
  before: string;
  after: string;
}

export interface WaitPayload {
  waitMs: number;
  reason: 'explicit' | 'navigation' | 'selector' | 'network';
  selector?: string;
}

export interface ScreenshotPayload {
  label: string;
  path: string;
  width: number;
  height: number;
  fullPage: boolean;
  sizeBytes: number;
}

export interface EvaluatePayload {
  script: string;
  result: unknown;
}

/** A behavioral step. `data` is the discriminated-union payload. */
export interface BehavioralStep {
  /** Unique ID. */
  id: string;
  /** Discriminator. */
  type: BehavioralStepType;
  /** ms since hunt start. */
  timestamp: number;
  /** Page URL at the moment of the step. */
  url: string;
  /** Which tab (multi-tab future). */
  tabId: string;
  /** Which browser context (multi-session future). */
  sessionId: string;
  /** Type-specific payload. The shape depends on `type`. */
  data: unknown;
  /** ID of the request step that this response is for (if response). */
  requestRef?: string;
  /** ID of the response step that triggered this (if error/notification follow-up). */
  responseRef?: string;
  /** Screenshot paths / DOM snapshot references captured for this step. */
  evidenceRefs: string[];
  /** LLM-assigned hint (post-hoc). */
  attackHint?: string;
  /** LLM-assigned severity 0-1 (post-hoc). */
  severityHint?: number;
}

/** Type-safe constructor for a step. */
export function makeStep<T extends BehavioralStepType>(
  id: string,
  type: T,
  timestamp: number,
  url: string,
  tabId: string,
  sessionId: string,
  data: ExtractByType<T>,
  evidenceRefs: string[] = []
): BehavioralStep {
  return { id, type, timestamp, url, tabId, sessionId, data, evidenceRefs };
}

/** Helper alias to map a type to its payload data shape. */
type ExtractByType<T extends BehavioralStepType> =
  T extends 'navigate' ? NavigatePayload :
  T extends 'click' ? ClickPayload :
  T extends 'fill' ? FillPayload :
  T extends 'request' ? RequestPayload :
  T extends 'response' ? ResponsePayload :
  T extends 'redirect' ? RedirectPayload :
  T extends 'notification' ? NotificationPayload :
  T extends 'console' ? ConsolePayload :
  T extends 'storage' ? StoragePayload :
  T extends 'mutation' ? MutationPayload :
  T extends 'error' ? ErrorPayload :
  T extends 'state' ? StatePayload :
  T extends 'wait' ? WaitPayload :
  T extends 'screenshot' ? ScreenshotPayload :
  T extends 'evaluate' ? EvaluatePayload :
  never;
