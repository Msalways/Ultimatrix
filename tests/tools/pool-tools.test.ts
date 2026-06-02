/**
 * tests/tools/pool-tools.test.ts
 *
 * Tests for buildSessionTools. We construct the tools with a mock
 * SessionPool and invoke them directly to verify schema + behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildSessionTools } from '../../src/tools/pool-tools';
import type { SessionPool, SessionMeta, SessionDiff } from '../../src/core/session-pool';

function makeMockPool(overrides: Partial<SessionPool> = {}): SessionPool {
  return {
    list: vi.fn(() => []),
    has: vi.fn(() => true),
    switchTo: vi.fn((id: string) => makeMeta(id, 'user')),
    login: vi.fn(async () => ({ ok: true, status: 200, finalUrl: '', body: '{}', cookiesAfter: 1 })),
    diff: vi.fn(async () => makeMockDiff()),
    screenshot: vi.fn(async () => '/tmp/shot.png'),
    getOrCreate: vi.fn(async (id: string) => makeMeta(id, 'user')),
    getActive: vi.fn(() => null),
    getCookies: vi.fn(async () => []),
    getPage: vi.fn(async () => ({ locator: () => ({ first: () => ({ innerText: async () => 'page text' }) }) }) as any),
    getNetworkLog: vi.fn(() => []),
    getInternalSession: vi.fn(() => null),
    close: vi.fn(async () => {}),
    closeAll: vi.fn(async () => {}),
    ...overrides,
  } as unknown as SessionPool;
}

function makeMeta(id: string, role: 'user' | 'admin' | 'anon' = 'user'): SessionMeta {
  return { id, label: id, role, createdAt: 0, lastActivityAt: 0, lastUrl: '', cookiesCount: 0, authenticated: false };
}

function makeMockDiff(): SessionDiff {
  return {
    sessionA: { id: 'a', label: 'a', role: 'user', status: 200, body: '{}', headers: {}, bodyLength: 2, cookiesSent: 1 },
    sessionB: { id: 'b', label: 'b', role: 'user', status: 200, body: '{"x":1}', headers: {}, bodyLength: 7, cookiesSent: 1 },
    statusMatch: true, bodyEqual: false, bodyLengthDiff: -5, leakDetected: true,
    notes: ['Different bodies with matching 200'],
  };
}

describe('buildPoolTools', () => {
  let pool: SessionPool;
  let ctx: { pool: SessionPool; getActiveSessionId: () => string | null; setActiveSessionId: (id: string | null) => void; getPage: (id: string) => Promise<any> };
  let active: string | null = null;

  beforeEach(() => {
    pool = makeMockPool();
    active = null;
    ctx = {
      pool,
      getActiveSessionId: () => active,
      setActiveSessionId: (id) => { active = id; },
      getPage: async (id) => {
        if (id === 'bad') throw new Error('not found');
        return {
          locator: () => ({ first: () => ({ innerText: async () => 'visible text' }) }),
          evaluate: async () => 'evaluated body text',
        } as any;
      },
    };
  });

  it('list_sessions returns pool.list() output', async () => {
    (pool.list as any).mockReturnValue([makeMeta('a'), makeMeta('b')]);
    const tools = buildSessionTools(ctx);
    const result = await (tools.listSessions as any).invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.sessions).toHaveLength(2);
  });

  it('switch_session updates active id and returns meta', async () => {
    (pool.has as any).mockReturnValue(true);
    (pool.switchTo as any).mockReturnValue(makeMeta('a'));
    const tools = buildSessionTools(ctx);
    const result = await (tools.switchSession as any).invoke({ sessionId: 'a' });
    expect(active).toBe('a');
    expect(JSON.parse(result).switchedTo.id).toBe('a');
  });

  it('switch_session returns error for unknown id', async () => {
    (pool.has as any).mockReturnValue(false);
    const tools = buildSessionTools(ctx);
    const result = await (tools.switchSession as any).invoke({ sessionId: 'ghost' });
    expect(JSON.parse(result).error).toContain('not found');
  });

  it('login_session calls pool.login with provided creds', async () => {
    (pool.has as any).mockReturnValue(true);
    const tools = buildSessionTools(ctx);
    await (tools.loginSession as any).invoke({
      sessionId: 'a',
      loginEndpoint: 'https://x.com/login',
      fields: { email: 'a@b.com', password: 'pw' },
    });
    const calls = (pool.login as any).mock.calls;
    expect(calls[0][0]).toBe('a');
    expect(calls[0][1].loginEndpoint).toBe('https://x.com/login');
    expect(calls[0][1].fields.email).toBe('a@b.com');
  });

  it('diff_sessions calls pool.diff and returns the result', async () => {
    (pool.has as any).mockReturnValue(true);
    const tools = buildSessionTools(ctx);
    const result = await (tools.diffSessions as any).invoke({
      sessionA: 'a', sessionB: 'b', url: 'https://x.com/api', method: 'GET',
    });
    const parsed = JSON.parse(result);
    expect(parsed.leakDetected).toBe(true);
  });

  it('screenshot_session writes to pool.screenshot and returns path', async () => {
    (pool.has as any).mockReturnValue(true);
    const tools = buildSessionTools(ctx);
    const result = await (tools.screenshotSession as any).invoke({ sessionId: 'a', fullPage: false });
    expect(JSON.parse(result).screenshot).toBe('/tmp/shot.png');
  });

  it('get_page_text reads from page.evaluate when no selector', async () => {
    (pool.has as any).mockReturnValue(true);
    const tools = buildSessionTools(ctx);
    const result = await (tools.getPageText as any).invoke({ sessionId: 'a' });
    expect(JSON.parse(result).text).toBe('evaluated body text');
  });

  it('get_page_text uses locator when selector is provided', async () => {
    (pool.has as any).mockReturnValue(true);
    const tools = buildSessionTools(ctx);
    const result = await (tools.getPageText as any).invoke({ sessionId: 'a', selector: '.hint' });
    expect(JSON.parse(result).text).toBe('visible text');
  });
});
