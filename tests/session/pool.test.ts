// tests/session/pool.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MultiSessionPool, makeDefaultPool } from '../../src/session/pool';
import { BrowserSessionManager } from '../../src/core/browser-session';

describe('MultiSessionPool', () => {
  let pool: MultiSessionPool;
  beforeEach(() => {
    pool = new MultiSessionPool();
  });

  it('starts empty', () => {
    expect(pool.size()).toBe(0);
    expect(pool.listIds()).toEqual([]);
    expect(pool.getActiveId()).toBeNull();
  });

  it('registers sessions', () => {
    const id1 = pool.register({ label: 'alice', role: 'user' });
    const id2 = pool.register({ label: 'bob', role: 'user' });
    expect(pool.size()).toBe(2);
    expect(pool.listIds()).toEqual([id1, id2]);
  });

  it('first registered session is active by default', () => {
    const id = pool.register({ label: 'alice', role: 'user' });
    expect(pool.getActiveId()).toBe(id);
  });

  it('setActive switches active session', () => {
    pool.register({ label: 'a', role: 'user' });
    const b = pool.register({ label: 'b', role: 'user' });
    pool.setActive(b);
    expect(pool.getActiveId()).toBe(b);
  });

  it('setActive throws on unknown id', () => {
    expect(() => pool.setActive('nope')).toThrow();
  });

  it('get returns the session manager', () => {
    const id = pool.register({ label: 'a', role: 'user' });
    const mgr = pool.get(id);
    expect(mgr).toBeInstanceOf(BrowserSessionManager);
  });

  it('list returns metadata', () => {
    pool.register({ label: 'alice', role: 'user', cookies: { session: 'a' } });
    const list = pool.list();
    expect(list).toHaveLength(1);
    expect(list[0].cookies.session).toBe('a');
  });

  it('captureCookies merges into existing', () => {
    const id = pool.register({ label: 'a', role: 'user', cookies: { x: '1' } });
    pool.captureCookies(id, { y: '2' });
    expect(pool.getCookies(id)).toEqual({ x: '1', y: '2' });
  });

  it('getHeaders returns empty object for unregistered', () => {
    expect(pool.getHeaders('nope')).toEqual({});
  });

  it('diffSessions with 1 session yields empty result', async () => {
    pool.register({ label: 'a', role: 'user' });
    const result = await pool.diffSessions('https://x.com', { fetcher: async () => ({ status: 200, body: 'x' }) });
    expect(result.diverged).toBe(false);
    expect(result.divergingPairs).toEqual([]);
  });

  it('diffSessions with 0 sessions yields empty result', async () => {
    const result = await pool.diffSessions('https://x.com', { fetcher: async () => ({ status: 200, body: 'x' }) });
    expect(result.diverged).toBe(false);
  });

  it('diffSessions with 2 sessions that diverge flags BOLA', async () => {
    pool.register({ id: 'a', label: 'a', role: 'user' });
    pool.register({ id: 'b', label: 'b', role: 'user' });
    const fetcher = async (id: string) => ({ status: 200, body: id === 'a' ? 'AAA' : 'BBB' });
    const result = await pool.diffSessions('https://x.com', { fetcher });
    expect(result.diverged).toBe(true);
    expect(result.divergingPairs.length).toBe(1);
    expect(pool.getBolaAlerts()).toHaveLength(1);
  });

  it('diffSessions with identical bodies does not flag BOLA', async () => {
    pool.register({ id: 'a', label: 'a', role: 'user' });
    pool.register({ id: 'b', label: 'b', role: 'user' });
    const fetcher = async () => ({ status: 200, body: 'SAME' });
    const result = await pool.diffSessions('https://x.com', { fetcher });
    expect(result.diverged).toBe(false);
  });

  it('diffSessions captures per-session status and latency', async () => {
    pool.register({ id: 'a', label: 'a', role: 'user' });
    pool.register({ id: 'b', label: 'b', role: 'user' });
    const fetcher = async (id: string) => ({ status: id === 'a' ? 200 : 403, body: 'x' });
    const result = await pool.diffSessions('https://x.com', { fetcher });
    expect(result.perSession).toHaveLength(2);
    expect(result.perSession.find((p) => p.sessionId === 'a')!.status).toBe(200);
    expect(result.perSession.find((p) => p.sessionId === 'b')!.status).toBe(403);
  });

  it('clearBolaAlerts resets', async () => {
    pool.register({ id: 'a', label: 'a', role: 'user' });
    pool.register({ id: 'b', label: 'b', role: 'user' });
    await pool.diffSessions('https://x.com', { fetcher: async (id) => ({ status: 200, body: id === 'a' ? 'AAA' : 'BBB' }) });
    expect(pool.getBolaAlerts()).toHaveLength(1);
    pool.clearBolaAlerts();
    expect(pool.getBolaAlerts()).toHaveLength(0);
  });

  it('makeDefaultPool creates anonymous session when no creds', () => {
    const p = makeDefaultPool();
    expect(p.size()).toBe(1);
    expect(p.list()[0].role).toBe('anonymous');
  });

  it('makeDefaultPool creates 2 sessions when creds provided', () => {
    const p = makeDefaultPool({ a: { label: 'alice', role: 'user' }, b: { label: 'admin', role: 'admin' } });
    expect(p.size()).toBe(2);
  });
});
