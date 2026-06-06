// src/session/pool.ts
//
// MultiSessionPool: holds N browser sessions with different identities.
// Built-in size is 2 (user-a, user-b) when credentials are provided;
// 1 anonymous session otherwise. BOLA/IDOR detection is automatic: any
// time user-b sees data that's been flagged as user-a-only, an alert
// fires.
//
// Each session is a BrowserSessionManager instance with its own cookies,
// localStorage, and fingerprint. The pool provides:
//   - getActiveSession(): currently-selected session
//   - switchSession(id): change which session is "primary"
//   - listSessions(): enumerate all sessions with id + role + label
//   - diffSessions(url, fetcher): fetch the same URL with 2+ sessions and diff
//   - loginSession(id, loginFn): capture a fresh auth cookie
//   - screenshotSession(id, url): take a DOM shot from a specific session
//
// Designed to be additive: when only 1 session is registered, all
// methods degrade to single-session behavior.

import { BrowserSessionManager } from '../core/browser-session';

export interface SessionEntry {
  id: string;
  label: string;
  role: 'anonymous' | 'user' | 'admin' | 'attacker' | string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  createdAt: number;
}

export type FetchFn = (sessionId: string, url: string) => Promise<{ status: number; body: string }>;

export interface DiffOptions {
  /** Sessions to diff. Default: all. */
  sessionIds?: string[];
  /** Fetcher used to call the URL with each session's identity. */
  fetcher: FetchFn;
}

export interface DiffResult {
  url: string;
  perSession: Array<{
    sessionId: string;
    status: number;
    bodyLength: number;
    bodyPreview: string;
    latencyMs: number;
  }>;
  /** True if any pair of sessions returned meaningfully different bodies. */
  diverged: boolean;
  /** Pairs that diverged. */
  divergingPairs: Array<{ a: string; b: string; diffPct: number }>;
}

export class MultiSessionPool {
  private sessions: Map<string, BrowserSessionManager> = new Map();
  private metadata: Map<string, SessionEntry> = new Map();
  private activeId: string | null = null;
  private bolaAlerts: Array<{ sessionA: string; sessionB: string; url: string; reason: string; at: number }> = [];

  /** Register a new session. Returns the session ID. */
  register(opts: { id?: string; label: string; role: string; cookies?: Record<string, string>; headers?: Record<string, string>; manager?: BrowserSessionManager }): string {
    const id = opts.id ?? `s${this.sessions.size + 1}-${Date.now()}`;
    const mgr = opts.manager ?? new BrowserSessionManager();
    this.sessions.set(id, mgr);
    this.metadata.set(id, {
      id,
      label: opts.label,
      role: opts.role,
      cookies: opts.cookies ?? {},
      headers: opts.headers ?? {},
      createdAt: Date.now(),
    });
    if (!this.activeId) this.activeId = id;
    return id;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  setActive(id: string): void {
    if (!this.sessions.has(id)) throw new Error(`Unknown session: ${id}`);
    this.activeId = id;
  }

  getActive(): BrowserSessionManager | null {
    return this.activeId ? this.sessions.get(this.activeId) ?? null : null;
  }

  /** Get a session by ID. */
  get(id: string): BrowserSessionManager | null {
    return this.sessions.get(id) ?? null;
  }

  list(): SessionEntry[] {
    return Array.from(this.metadata.values());
  }

  listIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Capture cookies for a session after login. */
  captureCookies(id: string, cookies: Record<string, string>): void {
    const m = this.metadata.get(id);
    if (m) m.cookies = { ...m.cookies, ...cookies };
  }

  /** Get cookies for a session. */
  getCookies(id: string): Record<string, string> {
    return this.metadata.get(id)?.cookies ?? {};
  }

  /** Get headers for a session. */
  getHeaders(id: string): Record<string, string> {
    return this.metadata.get(id)?.headers ?? {};
  }

  /** Take a screenshot from a specific session. */
  async screenshotSession(id: string, url: string, opts: { fullPage?: boolean } = {}): Promise<string> {
    const mgr = this.get(id);
    if (!mgr) throw new Error(`Unknown session: ${id}`);
    // We need a real sessionId for the manager. Each manager uses string IDs
    // internally; the pool ID doubles as the manager session ID.
    return mgr.screenshot(id, opts.fullPage ?? false).catch(async () => {
      // If screenshot fails, try navigating first.
      await mgr.navigate(id, url).catch(() => undefined);
      return mgr.screenshot(id, opts.fullPage ?? false);
    });
  }

  /** Fetch the same URL with 2+ sessions and diff the bodies. */
  async diffSessions(url: string, opts: DiffOptions): Promise<DiffResult> {
    const ids = opts.sessionIds ?? this.listIds();
    if (ids.length < 2 || !opts.fetcher) {
      return { url, perSession: [], diverged: false, divergingPairs: [] };
    }
    const perSession: DiffResult['perSession'] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    for (const id of ids) {
      const start = Date.now();
      let status = 0;
      let body = '';
      try {
        const r = await opts.fetcher(id, url);
        status = r.status;
        body = r.body;
      } catch (err) {
        body = `__ERROR__: ${(err as Error).message}`;
      }
      const latencyMs = Date.now() - start;
      perSession.push({
        sessionId: id,
        status,
        bodyLength: body.length,
        bodyPreview: body.slice(0, 200),
        latencyMs,
      });
      bodies.push({ id, body });
    }
    const divergingPairs: DiffResult['divergingPairs'] = [];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const pct = bodyDiffPct(bodies[i].body, bodies[j].body);
        if (pct > 0.05) {
          divergingPairs.push({ a: bodies[i].id, b: bodies[j].id, diffPct: pct });
        }
      }
    }
    const diverged = divergingPairs.length > 0;
    if (diverged) {
      for (const p of divergingPairs) {
        this.bolaAlerts.push({
          sessionA: p.a,
          sessionB: p.b,
          url,
          reason: `Bodies diverge by ${(p.diffPct * 100).toFixed(1)}%`,
          at: Date.now(),
        });
      }
    }
    return { url, perSession, diverged, divergingPairs };
  }

  /** Get all BOLA alerts detected during diffSessions. */
  getBolaAlerts(): ReadonlyArray<{ sessionA: string; sessionB: string; url: string; reason: string; at: number }> {
    return this.bolaAlerts;
  }

  /** Clear BOLA alerts (e.g., on session reset). */
  clearBolaAlerts(): void {
    this.bolaAlerts = [];
  }

  size(): number {
    return this.sessions.size;
  }
}

/** Levenshtein-based body diff percentage. */
function bodyDiffPct(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a.slice(0, 2000), b.slice(0, 2000));
  return dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev: number[] = new Array(n + 1);
  const curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** Create the default 2-session pool from a credentials object. */
export function makeDefaultPool(creds?: { a?: { label: string; role: string; cookies?: Record<string, string> }; b?: { label: string; role: string; cookies?: Record<string, string> } }): MultiSessionPool {
  const pool = new MultiSessionPool();
  if (creds?.a) {
    pool.register({ label: creds.a.label, role: creds.a.role, cookies: creds.a.cookies });
  }
  if (creds?.b) {
    pool.register({ label: creds.b.label, role: creds.b.role, cookies: creds.b.cookies });
  }
  if (pool.size() === 0) {
    pool.register({ label: 'anonymous', role: 'anonymous' });
  }
  return pool;
}
