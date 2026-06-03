// tests/primitives/observation.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseResponse,
  compareResponses,
  checkWaf,
  findEndpointsInResponse,
  extractSessionCookie,
  extractCsrfToken,
} from '../../src/primitives/observation';
import type { PrimitiveContext, PrimitiveResponse } from '../../src/primitives/types';

const ctx: PrimitiveContext = {
  baseUrl: 'http://test.local',
  cookies: {},
  evidenceLog: [],
  depth: 0,
  budget: { startedAt: 0, maxMs: 0 },
};

function makeResponse(over: Partial<PrimitiveResponse> = {}): PrimitiveResponse {
  return {
    status: 200,
    url: 'http://test.local/api',
    finalUrl: 'http://test.local/api',
    headers: { 'content-type': 'application/json' },
    body: '{"id":1,"name":"alice"}',
    durationMs: 5,
    redirects: [],
    timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
    ...over,
  };
}

describe('parseResponse', () => {
  it('extracts JSON', () => {
    const r = parseResponse.execute(makeResponse(), ctx);
    expect(r.ok).toBe(true);
    expect((r.value as any).json).toEqual({ id: 1, name: 'alice' });
  });

  it('returns null JSON on non-JSON', () => {
    const r = parseResponse.execute(makeResponse({ body: '<html></html>' }), ctx);
    expect((r.value as any).json).toBeNull();
  });

  it('collects text snippets from nested JSON', () => {
    const r = parseResponse.execute(
      makeResponse({ body: '{"data":{"key":"SECRET_VALUE","other":"x"}}' }),
      ctx,
    );
    expect((r.value as any).textSnippets).toContain('SECRET_VALUE');
  });
});

describe('compareResponses', () => {
  it('returns 0 divergence for identical JSON', () => {
    const r = compareResponses.execute(
      { baseline: makeResponse(), target: makeResponse() },
      ctx,
    );
    expect((r.value as any).divergence).toBe(0);
    expect((r.value as any).vulnerable).toBe(false);
  });

  it('returns high divergence for different JSON', () => {
    const r = compareResponses.execute(
      {
        baseline: makeResponse({ body: '{"id":1,"role":"guest"}' }),
        target: makeResponse({ body: '{"id":1,"role":"admin","secrets":["x"]}' }),
      },
      ctx,
    );
    expect((r.value as any).divergence).toBeGreaterThan(0.2);
    expect((r.value as any).vulnerable).toBe(true);
  });

  it('ignores noise keys like timestamp', () => {
    const r = compareResponses.execute(
      {
        baseline: makeResponse({ body: '{"id":1,"timestamp":1000}' }),
        target: makeResponse({ body: '{"id":1,"timestamp":2000}' }),
      },
      ctx,
    );
    expect((r.value as any).divergence).toBe(0);
  });

  it('flags IDOR-like response size divergence', () => {
    const r = compareResponses.execute(
      {
        baseline: makeResponse({ body: '{"id":1}' }),
        target: makeResponse({ body: '{"id":1,"email":"a","name":"a","phone":"a","address":"a","ssn":"a","cc":"a","secret":"a","extra":"a","long":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' }),
      },
      ctx,
    );
    expect((r.value as any).vulnerable).toBe(true);
  });
});

describe('checkWaf', () => {
  it('detects Cloudflare', () => {
    const r = checkWaf.execute(
      { response: makeResponse({ headers: { 'cf-ray': 'abc123', 'server': 'cloudflare' } }) },
      ctx,
    );
    expect((r.value as any).detected).toBe(true);
    expect((r.value as any).vendor).toBe('cloudflare');
  });

  it('returns no WAF when no fingerprints match', () => {
    const r = checkWaf.execute({ response: makeResponse() }, ctx);
    expect((r.value as any).detected).toBe(false);
    expect((r.value as any).vendor).toBe('unknown');
  });
});

describe('findEndpointsInResponse', () => {
  it('extracts URLs from HTML', () => {
    const html = '<a href="/users">Users</a><a href="https://other.com/x">X</a><a href="/api/v1">API</a>';
    const r = findEndpointsInResponse.execute({ html, baseUrl: 'http://test.local' }, ctx);
    const v = r.value as string[];
    expect(v).toContain('http://test.local/users');
    expect(v).toContain('http://test.local/api/v1');
    expect(v.find((u) => u.includes('other.com'))).toBeUndefined(); // off-origin filtered
  });

  it('extracts form actions', () => {
    const html = '<form method="POST" action="/api/login">';
    const r = findEndpointsInResponse.execute({ html, baseUrl: 'http://test.local' }, ctx);
    expect((r.value as string[])).toContain('http://test.local/api/login');
  });
});

describe('extractSessionCookie', () => {
  it('parses set-cookie header', () => {
    const r = extractSessionCookie.execute(
      { response: makeResponse({ headers: { 'set-cookie': 'session=abc123; Path=/; HttpOnly' } }) },
      ctx,
    );
    expect((r.value as any).cookies.session).toBe('abc123');
  });

  it('returns empty when no cookies', () => {
    const r = extractSessionCookie.execute({ response: makeResponse() }, ctx);
    expect(Object.keys((r.value as any).cookies).length).toBe(0);
  });
});

describe('extractCsrfToken', () => {
  it('extracts CSRF token from form', () => {
    const html = '<form><input name="csrf_token" value="abc123"/><input name="email"/></form>';
    const r = extractCsrfToken.execute({ html }, ctx);
    expect((r.value as any).tokenName).toBe('csrf_token');
    expect((r.value as any).tokenValue).toBe('abc123');
  });

  it('returns null when no token', () => {
    const r = extractCsrfToken.execute({ html: '<form><input name="email"/></form>' }, ctx);
    expect((r.value as any).tokenName).toBeNull();
  });
});
