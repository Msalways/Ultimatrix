/**
 * src/core/session-pool.ts
 *
 * Multi-session manager for RBAC-aware security testing.
 *
 * Why: a single Playwright context can only impersonate one user. To test
 * IDOR, broken function-level auth, and cross-user access, the worker
 * needs N independent browser contexts (each with its own cookies, storage,
 * and Playwright context), and tools to switch between them, login each,
 * and diff their responses to the same request.
 *
 * The pool is a process-local singleton by default (`getDefaultSessionPool`),
 * so a strategist agent and a worker thread can share sessions via the
 * pool handle passed through `WorkerConfig`.
 *
 * For tests: pass a `BrowserFactory` that returns mock browser/context/page
 * objects so we never spin up real Chromium in unit tests.
 */

import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

// ── Types ──────────────────────────────────────────────────────────────

export type SessionRole = 'anon' | 'user' | 'admin' | 'mechanic' | 'driver' | 'custom';

export interface SessionOptions {
  label?: string;
  role?: SessionRole;
  customRoleName?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  storageStatePath?: string;
}

export interface SessionMeta {
  id: string;
  label: string;
  role: SessionRole;
  customRoleName?: string;
  createdAt: number;
  lastActivityAt: number;
  lastUrl: string;
  cookiesCount: number;
  authenticated: boolean;
}

export interface LoginOptions {
  loginEndpoint: string;
  method?: 'GET' | 'POST';
  fields: Record<string, string>;
  contentType?: 'json' | 'form';
  expectedStatus?: number | number[];
}

export interface LoginResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: string;
  cookiesAfter: number;
  error?: string;
}

export interface DiffRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
}

export interface DiffResponseSide {
  id: string;
  label: string;
  role: SessionRole;
  status: number;
  body: string;
  headers: Record<string, string>;
  bodyLength: number;
  cookiesSent: number;
}

export interface SessionDiff {
  sessionA: DiffResponseSide;
  sessionB: DiffResponseSide;
  statusMatch: boolean;
  bodyEqual: boolean;
  bodyLengthDiff: number;
  leakDetected: boolean;
  notes: string[];
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseHeaders: Record<string, string>;
  responseBodyExcerpt?: string;
  timestamp: number;
}

export interface BrowserFactory {
  launch(options: { sessionId: string; userAgent?: string; viewport?: { width: number; height: number } }): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
  }>;
}

// ── Default factory (real Playwright) ─────────────────────────────────

const defaultBrowserFactory: BrowserFactory = {
  async launch(options) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 720 },
      userAgent: options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await context.newPage();
    return { browser, context, page };
  },
};

// ── Internal session record ───────────────────────────────────────────

interface InternalSession {
  id: string;
  label: string;
  role: SessionRole;
  customRoleName?: string;
  createdAt: number;
  lastActivityAt: number;
  lastUrl: string;
  authenticated: boolean;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  networkLog: NetworkEntry[];
  screenshots: string[];
  credential?: Record<string, string>;
}

// ── Pool ──────────────────────────────────────────────────────────────

export interface SessionPoolOptions {
  headless?: boolean;
  screenshotDir?: string;
  browserFactory?: BrowserFactory;
  networkCaptureEnabled?: boolean;
  maxNetworkLogEntries?: number;
  maxBodyCaptureBytes?: number;
}

const DEFAULT_MAX_NETWORK_LOG = 500;
const DEFAULT_MAX_BODY_CAPTURE = 8192;

export class SessionPool {
  private sessions = new Map<string, InternalSession>();
  private activeSessionId: string | null = null;
  private browserFactory: BrowserFactory;
  private screenshotDir: string;
  private headless: boolean;
  private networkCaptureEnabled: boolean;
  private maxNetworkLogEntries: number;
  private maxBodyCaptureBytes: number;

  constructor(opts: SessionPoolOptions = {}) {
    this.headless = opts.headless ?? true;
    this.browserFactory = opts.browserFactory ?? defaultBrowserFactory;
    this.screenshotDir = opts.screenshotDir ?? './.sessions-screenshots';
    this.networkCaptureEnabled = opts.networkCaptureEnabled ?? true;
    this.maxNetworkLogEntries = opts.maxNetworkLogEntries ?? DEFAULT_MAX_NETWORK_LOG;
    this.maxBodyCaptureBytes = opts.maxBodyCaptureBytes ?? DEFAULT_MAX_BODY_CAPTURE;
  }

  async getOrCreate(id: string, options: SessionOptions = {}): Promise<SessionMeta> {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return this.toMeta(existing);
    }
    const { browser, context, page } = await this.browserFactory.launch({
      sessionId: id,
      userAgent: options.userAgent,
      viewport: options.viewport,
    });
    if (this.networkCaptureEnabled) this.attachNetworkCapture(id, context);
    const now = Date.now();
    const session: InternalSession = {
      id,
      label: options.label ?? id,
      role: options.role ?? 'anon',
      customRoleName: options.customRoleName,
      createdAt: now,
      lastActivityAt: now,
      lastUrl: '',
      authenticated: false,
      browser,
      context,
      page,
      networkLog: [],
      screenshots: [],
    };
    this.sessions.set(id, session);
    return this.toMeta(session);
  }

  switchTo(id: string): SessionMeta {
    const session = this.requireSession(id);
    this.activeSessionId = id;
    session.lastActivityAt = Date.now();
    return this.toMeta(session);
  }

  getActive(): SessionMeta | null {
    if (!this.activeSessionId) return null;
    const s = this.sessions.get(this.activeSessionId);
    return s ? this.toMeta(s) : null;
  }

  list(): SessionMeta[] {
    return Array.from(this.sessions.values()).map((s) => this.toMeta(s));
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  async login(id: string, opts: LoginOptions): Promise<LoginResult> {
    const session = this.requireSession(id);
    const method = (opts.method ?? 'POST').toUpperCase() as 'GET' | 'POST';
    const contentType = opts.contentType ?? 'json';
    const headers: Record<string, string> =
      contentType === 'form'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : { 'Content-Type': 'application/json' };
    const body = contentType === 'form' ? new URLSearchParams(opts.fields).toString() : JSON.stringify(opts.fields);
    let response;
    try {
      response = await session.context.request.fetch(opts.loginEndpoint, {
        method,
        headers,
        data: body,
        timeout: 30000,
      });
    } catch (e) {
      return {
        ok: false,
        status: 0,
        finalUrl: opts.loginEndpoint,
        body: '',
        cookiesAfter: 0,
        error: String(e),
      };
    }
    const status = response.status();
    const respBody = await response.text();
    const finalUrl = response.url();
    const cookies = await session.context.cookies();
    session.credential = opts.fields;
    const expected = Array.isArray(opts.expectedStatus) ? opts.expectedStatus : [opts.expectedStatus ?? 200];
    const ok = expected.includes(status) || status === 302;
    if (ok) {
      session.authenticated = true;
      session.lastUrl = finalUrl;
    }
    session.lastActivityAt = Date.now();
    return { ok, status, finalUrl, body: respBody, cookiesAfter: cookies.length, error: ok ? undefined : `unexpected status ${status}` };
  }

  async diff(idA: string, idB: string, req: DiffRequest): Promise<SessionDiff> {
    const a = this.requireSession(idA);
    const b = this.requireSession(idB);
    const method = (req.method ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    const headers = req.headers ?? {};
    const data = req.body;
    const [resA, resB] = await Promise.all([
      a.context.request.fetch(req.url, { method, headers, data, timeout: 30000 }),
      b.context.request.fetch(req.url, { method, headers, data, timeout: 30000 }),
    ]);
    const [statusA, statusB] = [resA.status(), resB.status()];
    const [bodyA, bodyB] = await Promise.all([resA.text(), resB.text()]);
    const [hdrA, hdrB] = [resA.headersArray(), resB.headersArray()];
    const [cookiesA, cookiesB] = await Promise.all([a.context.cookies(), b.context.cookies()]);
    const sideA: DiffResponseSide = {
      id: a.id, label: a.label, role: a.role, status: statusA, body: bodyA, headers: headersArrayToObject(hdrA),
      bodyLength: bodyA.length, cookiesSent: cookiesA.length,
    };
    const sideB: DiffResponseSide = {
      id: b.id, label: b.label, role: b.role, status: statusB, body: bodyB, headers: headersArrayToObject(hdrB),
      bodyLength: bodyB.length, cookiesSent: cookiesB.length,
    };
    const bodyEqual = bodyA === bodyB;
    const statusMatch = statusA === statusB;
    const bodyLengthDiff = bodyA.length - bodyB.length;
    const notes: string[] = [];
    if (!bodyEqual && statusMatch && statusA === 200) {
      notes.push(`Different bodies with matching 200 status — possible cross-user data leak`);
    }
    if (statusA === 200 && statusB === 401) {
      notes.push(`A (${a.label}) accessed; B (${b.label}) was 401'd — possible IDOR`);
    }
    if (statusA === 200 && statusB === 403) {
      notes.push(`A (${a.label}) accessed; B (${b.label}) got 403 — possible missing authz`);
    }
    if (bodyEqual && statusMatch && a.id !== b.id) {
      notes.push(`Identical bodies for different sessions — likely a static response`);
    }
    const leakDetected = notes.length > 0;
    a.lastActivityAt = Date.now();
    b.lastActivityAt = Date.now();
    return { sessionA: sideA, sessionB: sideB, statusMatch, bodyEqual, bodyLengthDiff, leakDetected, notes };
  }

  async screenshot(id: string, opts: { fullPage?: boolean; path?: string } = {}): Promise<string> {
    const session = this.requireSession(id);
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    const filename = opts.path ?? `${id}-${Date.now()}.png`;
    const fullPath = path.isAbsolute(filename) ? filename : path.join(this.screenshotDir, filename);
    await session.page.screenshot({ path: fullPath, fullPage: opts.fullPage ?? true });
    session.screenshots.push(fullPath);
    session.lastActivityAt = Date.now();
    return fullPath;
  }

  async getCookies(id: string): Promise<Array<{ name: string; value: string; domain: string }>> {
    const session = this.requireSession(id);
    const cookies = await session.context.cookies();
    return cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain }));
  }

  async setCookies(id: string, cookies: Array<Partial<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None'; url: string }>>): Promise<number> {
    const session = this.requireSession(id);
    const sanitized = cookies
      .filter((c) => c.name && c.value !== undefined && c.value !== null && c.value !== '')
      .map((c) => {
        const out: Record<string, unknown> = { name: c.name, value: c.value };
        if (c.url) out.url = c.url;
        else {
          if (c.domain) out.domain = c.domain;
          if (c.path) out.path = c.path;
        }
        if (c.expires !== undefined) out.expires = c.expires;
        if (c.httpOnly !== undefined) out.httpOnly = c.httpOnly;
        if (c.secure !== undefined) out.secure = c.secure;
        if (c.sameSite) out.sameSite = c.sameSite;
        return out;
      });
    if (sanitized.length === 0) return 0;
    await session.context.addCookies(sanitized as any);
    session.lastActivityAt = Date.now();
    return sanitized.length;
  }

  async getPage(id: string): Promise<Page> {
    const session = this.requireSession(id);
    session.lastActivityAt = Date.now();
    return session.page;
  }

  getNetworkLog(id: string, limit = 50): NetworkEntry[] {
    const session = this.sessions.get(id);
    if (!session) return [];
    return session.networkLog.slice(-limit);
  }

  getInternalSession(id: string): InternalSession | null {
    return this.sessions.get(id) ?? null;
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    try { await session.context.close(); } catch {}
    try { await session.browser.close(); } catch {}
    this.sessions.delete(id);
    if (this.activeSessionId === id) this.activeSessionId = null;
  }

  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.close(id)));
  }

  private requireSession(id: string): InternalSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(
        `Session "${id}" not found. Available: [${Array.from(this.sessions.keys()).join(', ') || 'none'}]. Call getOrCreate() first.`,
      );
    }
    session.lastActivityAt = Date.now();
    return session;
  }

  private toMeta(s: InternalSession): SessionMeta {
    return {
      id: s.id,
      label: s.label,
      role: s.role,
      customRoleName: s.customRoleName,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      lastUrl: s.lastUrl,
      cookiesCount: 0,
      authenticated: s.authenticated,
    };
  }

  private attachNetworkCapture(_id: string, _context: BrowserContext): void {
    // No-op in production. Real network capture uses page.on('response') at the
    // page level, set up per-page in getOrCreate consumers. Kept as a hook for
    // future integration.
  }
}

function headersArrayToObject(arr: Array<{ name: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value } of arr) out[name.toLowerCase()] = value;
  return out;
}

// ── Singleton helpers ─────────────────────────────────────────────────

let defaultPool: SessionPool | null = null;

export function getDefaultSessionPool(opts?: SessionPoolOptions): SessionPool {
  if (!defaultPool) defaultPool = new SessionPool(opts);
  return defaultPool;
}

export function resetDefaultSessionPool(): void {
  defaultPool = null;
}
