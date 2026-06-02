/**
 * tests/core/auth-flow.test.ts
 *
 * Tests for AuthFlow.discoverAndPopulate. We use a mock SessionPool so
 * tests run without Playwright.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthFlow, regexRoleDiscoverer, type DetectedRole, type RoleDiscoverer } from '../../src/core/auth-flow';
import type { SessionPool, SessionMeta, LoginResult } from '../../src/core/session-pool';

function makeSessionMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', label: 's1', role: 'anon', createdAt: 0, lastActivityAt: 0,
    lastUrl: '', cookiesCount: 0, authenticated: false, ...overrides,
  };
}

function makeMockPool(overrides: Partial<SessionPool> = {}): SessionPool {
  const sessionList: SessionMeta[] = [];
  const loginCalls: Array<{ id: string; endpoint: string; fields: Record<string,string> }> = [];
  return {
    list: vi.fn(() => sessionList),
    getOrCreate: vi.fn(async (id: string, opts?: any) => {
      const meta = makeSessionMeta({ id, label: opts?.label ?? id, role: opts?.role ?? 'anon' });
      sessionList.push(meta);
      return meta;
    }),
    login: vi.fn(async (id: string, opts: { loginEndpoint: string; fields: Record<string,string> }) => {
      loginCalls.push({ id, endpoint: opts.loginEndpoint, fields: opts.fields });
      return { ok: true, status: 200, finalUrl: 'https://x.com/dashboard', body: '{}', cookiesAfter: 1 } as LoginResult;
    }),
    switchTo: vi.fn(),
    getActive: vi.fn(() => null),
    has: vi.fn(() => true),
    screenshot: vi.fn(async () => '/tmp/x.png'),
    getCookies: vi.fn(async () => []),
    getPage: vi.fn(async () => ({}) as any),
    getNetworkLog: vi.fn(() => []),
    getInternalSession: vi.fn(() => null),
    close: vi.fn(async () => {}),
    closeAll: vi.fn(async () => {}),
    _loginCalls: loginCalls,
    _sessionList: sessionList,
    ...overrides,
  } as unknown as SessionPool;
}

describe('AuthFlow.discoverAndPopulate', () => {
  let pool: SessionPool;
  let auth: AuthFlow;

  beforeEach(() => {
    pool = makeMockPool();
    auth = new AuthFlow(pool, { maxSessions: 3 });
  });

  it('uses provided env creds via options.envCreds', async () => {
    const authWithEnv = new AuthFlow(pool, {
      envCreds: {
        admin: { email: 'a@x.com', password: 'pw' },
        user: { email: 'u@x.com', password: 'pw' },
      },
      maxSessions: 5,
    });
    const result = await authWithEnv.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Login',
      formActions: ['/api/v1/login'],
    });
    expect(result.detectedRoles.map((r) => r.name).sort()).toEqual(['admin', 'user']);
    expect(result.detectedRoles.every((r) => r.source === 'env')).toBe(true);
    expect(result.sessions.length).toBe(2);
  });

  it('falls back to regex detection when no env creds and no LLM', async () => {
    const result = await auth.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Login as admin or driver to access the mechanic dashboard',
      formActions: ['/login'],
    });
    const roleNames = result.detectedRoles.map((r) => r.name);
    expect(roleNames).toContain('admin');
    expect(roleNames).toContain('driver');
  });

  it('caps detected roles to maxSessions', async () => {
    const authCapped = new AuthFlow(pool, {
      envCreds: {
        admin: { email: 'a@x.com', password: 'pw' },
        user: { email: 'u@x.com', password: 'pw' },
        driver: { email: 'd@x.com', password: 'pw' },
        mechanic: { email: 'm@x.com', password: 'pw' },
        vip: { email: 'v@x.com', password: 'pw' },
      },
      maxSessions: 2,
    });
    const result = await authCapped.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'login',
      formActions: ['/login'],
    });
    expect(result.detectedRoles.length).toBe(2);
  });

  it('uses injected role discoverer', async () => {
    const discoverer: RoleDiscoverer = {
      detect: async () => [
        { name: 'mechanic', source: 'llm', credentials: { email: 'm@crapi.example', password: 'pw' } },
        { name: 'driver', source: 'llm', credentials: { email: 'd@crapi.example', password: 'pw' } },
      ],
    };
    const authLlm = new AuthFlow(pool, { roleDiscoverer: discoverer, maxSessions: 3 });
    const result = await authLlm.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Login', formActions: ['/api/v1/login'],
    });
    expect(result.detectedRoles.map((r) => r.name).sort()).toEqual(['driver', 'mechanic']);
    expect(result.detectedRoles.every((r) => r.source === 'llm')).toBe(true);
  });

  it('falls back to "user" default when no roles detected anywhere', async () => {
    const result = await auth.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'a static page with no login text',
      formActions: [],
    });
    const roleNames = result.detectedRoles.map((r) => r.name);
    expect(roleNames).toContain('user');
  });

  it('detects login form and resolves login endpoint from formActions', async () => {
    const result = await auth.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Please sign in',
      formActions: ['https://app.example.com/api/v1/login'],
    });
    expect(result.hasLogin).toBe(true);
    expect(result.loginEndpoint).toBe('https://app.example.com/api/v1/login');
  });

  it('detects signup form', async () => {
    const result = await auth.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Create a new account',
      formActions: ['/register'],
    });
    expect(result.hasSignup).toBe(true);
  });

  it('logs in each detected role via SessionPool.login', async () => {
    const authWithEnv = new AuthFlow(pool, {
      envCreds: {
        admin: { email: 'a@x.com', password: 'pw' },
        user: { email: 'u@x.com', password: 'pw' },
      },
      maxSessions: 5,
    });
    await authWithEnv.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Login', formActions: ['/login'],
    });
    const loginCalls = (pool.login as any).mock.calls;
    expect(loginCalls.length).toBe(2);
    const fieldsUsed = loginCalls.map((c: any) => c[1].fields);
    expect(fieldsUsed.some((f: any) => f.email === 'a@x.com')).toBe(true);
    expect(fieldsUsed.some((f: any) => f.email === 'u@x.com')).toBe(true);
  });

  it('skips login when no loginEndpoint is resolvable', async () => {
    const authNoLogin = new AuthFlow(pool, {
      envCreds: { user: { email: 'u@x.com', password: 'pw' } },
      maxSessions: 5,
    });
    const result = await authNoLogin.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'a static page', formActions: [],
    });
    expect(result.loginEndpoint).toBe('');
    const loginCalls = (pool.login as any).mock.calls;
    expect(loginCalls.length).toBe(0);
  });

  it('records errors when login fails', async () => {
    const poolFailing = makeMockPool({
      login: vi.fn(async () => ({ ok: false, status: 401, finalUrl: 'x', body: '', cookiesAfter: 0, error: 'unauthorized' } as LoginResult)),
    });
    const authFailing = new AuthFlow(poolFailing, {
      envCreds: { user: { email: 'u@x.com', password: 'pw' } },
      maxSessions: 5,
    });
    const result = await authFailing.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Login', formActions: ['/login'],
    });
    expect(result.errors.some((e) => e.includes('login failed'))).toBe(true);
  });

  it('attempts self-registration when signup is detected and registration probe is provided', async () => {
    const probe = {
      canRegister: vi.fn(async () => ({ ok: true, signupEndpoint: '/api/v1/register', fields: ['email', 'password', 'name'] })),
    };
    const authReg = new AuthFlow(pool, {
      roleDiscoverer: { detect: async () => [] },
      registrationProbe: probe,
      maxSessions: 3,
    });
    const result = await authReg.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Create account', formActions: ['/register'],
    });
    expect(probe.canRegister).toHaveBeenCalled();
    expect(result.detectedRoles.some((r) => r.name === 'self-registered')).toBe(true);
  });

  it('does not register when env creds are present (avoids polluting existing user pool)', async () => {
    const probe = { canRegister: vi.fn(async () => ({ ok: true })) };
    const authReg = new AuthFlow(pool, {
      envCreds: { user: { email: 'u@x.com', password: 'pw' } },
      roleDiscoverer: { detect: async () => [] },
      registrationProbe: probe,
      maxSessions: 3,
    });
    await authReg.discoverAndPopulate({} as any, 'https://app.example.com', {
      pageText: 'Create account', formActions: ['/register'],
    });
    expect(probe.canRegister).not.toHaveBeenCalled();
  });
});

describe('regexRoleDiscoverer', () => {
  it('returns a default user/admin/test set regardless of input', async () => {
    const result = await regexRoleDiscoverer.detect({} as any, 'https://x.com');
    expect(result.map((r) => r.name).sort()).toEqual(['admin', 'test', 'user']);
  });
});
