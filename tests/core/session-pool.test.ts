/**
 * tests/core/session-pool.test.ts
 *
 * Unit tests for the multi-session RBAC pool. We never spin up real
 * Chromium — instead we inject a BrowserFactory that returns mock
 * browser/context/page objects with a stub request.fetch().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionPool, getDefaultSessionPool, resetDefaultSessionPool } from '../../src/core/session-pool';
import type { BrowserFactory, Browser, BrowserContext, Page, Cookie } from './session-pool-test-helpers';
import { makeMockBrowserFactory, type MockContext } from './session-pool-test-helpers';

function makeCookie(name: string, value: string, domain = 'example.com'): Cookie {
  return { name, value, domain, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'None' };
}

describe('SessionPool', () => {
  let pool: SessionPool;
  let mockContexts: Map<string, MockContext>;

  beforeEach(() => {
    mockContexts = new Map();
    const factory: BrowserFactory = makeMockBrowserFactory(mockContexts);
    pool = new SessionPool({ browserFactory: factory, screenshotDir: './.test-screenshots' });
  });

  afterEach(async () => {
    await pool.closeAll();
    resetDefaultSessionPool();
  });

  describe('getOrCreate', () => {
    it('creates a new session with default anon role', async () => {
      const meta = await pool.getOrCreate('session-1');
      expect(meta.id).toBe('session-1');
      expect(meta.role).toBe('anon');
      expect(meta.authenticated).toBe(false);
      expect(pool.list()).toHaveLength(1);
    });

    it('accepts custom role and label', async () => {
      const meta = await pool.getOrCreate('admin', { role: 'admin', label: 'admin-user' });
      expect(meta.role).toBe('admin');
      expect(meta.label).toBe('admin-user');
    });

    it('returns existing session on second call without creating a new browser', async () => {
      const first = await pool.getOrCreate('session-1');
      const before = pool.list().length;
      const second = await pool.getOrCreate('session-1');
      expect(second.id).toBe(first.id);
      expect(pool.list().length).toBe(before);
    });

    it('creates separate browsers for separate session IDs', async () => {
      await pool.getOrCreate('user-a');
      await pool.getOrCreate('user-b');
      expect(mockContexts.size).toBe(2);
      expect(mockContexts.has('user-a-browser')).toBe(true);
      expect(mockContexts.has('user-b-browser')).toBe(true);
    });
  });

  describe('switchTo / getActive', () => {
    it('switches the active session', async () => {
      await pool.getOrCreate('a');
      await pool.getOrCreate('b');
      expect(pool.getActive()).toBeNull();
      pool.switchTo('a');
      expect(pool.getActive()?.id).toBe('a');
      pool.switchTo('b');
      expect(pool.getActive()?.id).toBe('b');
    });

    it('throws when switching to a non-existent session', () => {
      expect(() => pool.switchTo('nope')).toThrow(/Session "nope" not found/);
    });
  });

  describe('list', () => {
    it('returns metadata for all created sessions', async () => {
      await pool.getOrCreate('s1', { role: 'user' });
      await pool.getOrCreate('s2', { role: 'admin' });
      const list = pool.list();
      expect(list).toHaveLength(2);
      const roles = list.map((s) => s.role).sort();
      expect(roles).toEqual(['admin', 'user']);
    });
  });

  describe('login', () => {
    it('marks session authenticated on 200 response', async () => {
      const mock = await pool.getOrCreate('s1');
      const ctx = mockContexts.get('s1-browser')!;
      ctx.setResponse('POST', 'https://api.example.com/login', { status: 200, body: '{"ok":true}' });
      ctx.setCookies([makeCookie('session', 'abc123')]);
      const result = await pool.login('s1', {
        loginEndpoint: 'https://api.example.com/login',
        fields: { email: 'a@b.com', password: 'pw' },
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.cookiesAfter).toBe(1);
      const updated = pool.list().find((s) => s.id === 's1')!;
      expect(updated.authenticated).toBe(true);
    });

    it('sends JSON Content-Type by default', async () => {
      await pool.getOrCreate('s1');
      const ctx = mockContexts.get('s1-browser')!;
      ctx.setResponse('POST', 'https://api.example.com/login', { status: 200, body: '{}' });
      const result = await pool.login('s1', {
        loginEndpoint: 'https://api.example.com/login',
        fields: { x: 'y' },
      });
      const sentHeaders = ctx.lastRequest?.headers ?? {};
      expect(sentHeaders['Content-Type']).toBe('application/json');
      expect(JSON.parse(ctx.lastRequest?.body ?? '{}')).toEqual({ x: 'y' });
      expect(result.ok).toBe(true);
    });

    it('sends form Content-Type when requested', async () => {
      await pool.getOrCreate('s1');
      const ctx = mockContexts.get('s1-browser')!;
      ctx.setResponse('POST', 'https://api.example.com/login', { status: 200, body: '{}' });
      await pool.login('s1', {
        loginEndpoint: 'https://api.example.com/login',
        contentType: 'form',
        fields: { user: 'a', pw: 'b' },
      });
      const sentHeaders = ctx.lastRequest?.headers ?? {};
      expect(sentHeaders['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(ctx.lastRequest?.body).toBe('user=a&pw=b');
    });

    it('returns ok=false on 401', async () => {
      await pool.getOrCreate('s1');
      const ctx = mockContexts.get('s1-browser')!;
      ctx.setResponse('POST', 'https://api.example.com/login', { status: 401, body: 'unauthorized' });
      const result = await pool.login('s1', {
        loginEndpoint: 'https://api.example.com/login',
        fields: { x: 'y' },
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
      expect(pool.list().find((s) => s.id === 's1')!.authenticated).toBe(false);
    });

    it('captures network errors gracefully', async () => {
      await pool.getOrCreate('s1');
      const ctx = mockContexts.get('s1-browser')!;
      ctx.setResponse('POST', 'https://api.example.com/login', { status: 200, body: 'ok' });
      ctx.nextFetchThrows = true;
      const result = await pool.login('s1', {
        loginEndpoint: 'https://api.example.com/login',
        fields: { x: 'y' },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('simulated network failure');
    });
  });

  describe('diff', () => {
    it('detects IDOR: same status, different bodies across two users', async () => {
      await pool.getOrCreate('user-a', { role: 'user' });
      await pool.getOrCreate('user-b', { role: 'user' });
      const ctxA = mockContexts.get('user-a-browser')!;
      const ctxB = mockContexts.get('user-b-browser')!;
      ctxA.setResponse('GET', 'https://api.example.com/vehicles/1', { status: 200, body: '{"owner":"alice","plate":"AAA-001"}' });
      ctxB.setResponse('GET', 'https://api.example.com/vehicles/1', { status: 200, body: '{"owner":"bob","plate":"BBB-002"}' });
      const result = await pool.diff('user-a', 'user-b', { url: 'https://api.example.com/vehicles/1' });
      expect(result.statusMatch).toBe(true);
      expect(result.bodyEqual).toBe(false);
      expect(result.leakDetected).toBe(true);
      expect(result.notes.some((n) => n.includes('cross-user data leak'))).toBe(true);
    });

    it('detects auth boundary: A gets 200, B gets 401', async () => {
      await pool.getOrCreate('user-a');
      await pool.getOrCreate('user-b');
      mockContexts.get('user-a-browser')!.setResponse('GET', 'https://api.example.com/admin', { status: 200, body: '{"users":[]}' });
      mockContexts.get('user-b-browser')!.setResponse('GET', 'https://api.example.com/admin', { status: 401, body: 'unauthorized' });
      const result = await pool.diff('user-a', 'user-b', { url: 'https://api.example.com/admin' });
      expect(result.statusMatch).toBe(false);
      expect(result.leakDetected).toBe(true);
      expect(result.notes.some((n) => n.includes('IDOR'))).toBe(true);
    });

    it('returns no leak when bodies are identical and status matches (static response)', async () => {
      await pool.getOrCreate('a');
      await pool.getOrCreate('b');
      mockContexts.get('a-browser')!.setResponse('GET', 'https://api.example.com/health', { status: 200, body: 'ok' });
      mockContexts.get('b-browser')!.setResponse('GET', 'https://api.example.com/health', { status: 200, body: 'ok' });
      const result = await pool.diff('a', 'b', { url: 'https://api.example.com/health' });
      expect(result.leakDetected).toBe(true);
      expect(result.notes.some((n) => n.includes('static response'))).toBe(true);
    });

    it('reports bodyLengthDiff accurately', async () => {
      await pool.getOrCreate('a');
      await pool.getOrCreate('b');
      mockContexts.get('a-browser')!.setResponse('GET', 'https://api.example.com/x', { status: 200, body: 'short' });
      mockContexts.get('b-browser')!.setResponse('GET', 'https://api.example.com/x', { status: 200, body: 'much longer body content' });
      const result = await pool.diff('a', 'b', { url: 'https://api.example.com/x' });
      expect(result.bodyLengthDiff).toBe('short'.length - 'much longer body content'.length);
    });

    it('throws when either session does not exist', async () => {
      await pool.getOrCreate('a');
      await expect(pool.diff('a', 'nonexistent', { url: 'https://x.com' })).rejects.toThrow(/not found/);
    });
  });

  describe('setCookies', () => {
    it('pre-injects cookies into a session via Playwright storage state format', async () => {
      await pool.getOrCreate('s1');
      const count = await pool.setCookies('s1', [
        { name: 'lvl1', value: 'solved', domain: 'xss-game.appspot.com', path: '/' },
        { name: 'session', value: 'abc123', domain: '.appspot.com', path: '/' },
      ]);
      expect(count).toBe(2);
      const cookies = await pool.getCookies('s1');
      const names = cookies.map((c) => c.name).sort();
      expect(names).toContain('lvl1');
      expect(names).toContain('session');
    });

    it('skips cookies missing name or value', async () => {
      await pool.getOrCreate('s1');
      const count = await pool.setCookies('s1', [
        { name: 'good', value: 'ok' } as any,
        { name: '', value: 'x' } as any,
        { name: 'x', value: '' } as any,
      ]);
      expect(count).toBe(1);
    });

    it('uses url field when provided, otherwise domain+path', async () => {
      await pool.getOrCreate('s1');
      const count = await pool.setCookies('s1', [
        { name: 'with-url', value: '1', url: 'https://example.com/x' },
        { name: 'with-domain', value: '2', domain: 'example.com', path: '/y' },
      ]);
      expect(count).toBe(2);
    });
  });

  describe('screenshot', () => {
    it('captures a screenshot to the configured directory', async () => {
      await pool.getOrCreate('s1');
      const path = await pool.screenshot('s1', { path: 'test-shot.png' });
      expect(path).toContain('test-shot.png');
      const internal = pool.getInternalSession('s1')!;
      expect(internal.screenshots).toContain(path);
    });

    it('throws for unknown session', async () => {
      await expect(pool.screenshot('nope')).rejects.toThrow(/not found/);
    });
  });

  describe('closeAll / close', () => {
    it('closes all sessions and clears the list', async () => {
      await pool.getOrCreate('a');
      await pool.getOrCreate('b');
      await pool.closeAll();
      expect(pool.list()).toHaveLength(0);
      expect(mockContexts.size).toBe(0);
    });

    it('close() removes a single session', async () => {
      await pool.getOrCreate('a');
      await pool.getOrCreate('b');
      await pool.close('a');
      expect(pool.list()).toHaveLength(1);
      expect(pool.list()[0].id).toBe('b');
    });

    it('close() clears active session if it was active', async () => {
      await pool.getOrCreate('a');
      pool.switchTo('a');
      await pool.close('a');
      expect(pool.getActive()).toBeNull();
    });
  });

  describe('singleton helpers', () => {
    it('getDefaultSessionPool returns the same instance on repeat calls', () => {
      const a = getDefaultSessionPool();
      const b = getDefaultSessionPool();
      expect(a).toBe(b);
    });
    it('resetDefaultSessionPool clears the singleton', () => {
      const a = getDefaultSessionPool();
      resetDefaultSessionPool();
      const b = getDefaultSessionPool();
      expect(a).not.toBe(b);
    });
  });
});
