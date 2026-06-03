// tests/primitives/injection.test.ts
import { describe, it, expect } from 'vitest';
import { injectInContext, omitHeader } from '../../src/primitives/injection';
import type { PrimitiveContext } from '../../src/primitives/types';

const ctx: PrimitiveContext = {
  baseUrl: 'http://test.local',
  cookies: {},
  evidenceLog: [],
  depth: 0,
  budget: { startedAt: 0, maxMs: 0 },
};

describe('injectInContext', () => {
  it('injects into query string', () => {
    const r = injectInContext.execute(
      { payload: "' OR 1=1 --", location: 'query', base: { method: 'GET', url: 'http://test.local/api', headers: {} }, paramName: 'q' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const url = (r.value as any).url as string;
    expect(url).toContain('q=');
    // URLSearchParams encodes special chars but leaves some whitespace as-is
    expect(url).toMatch(/q=(%27|')/);
  });

  it('injects into JSON body', () => {
    const r = injectInContext.execute(
      { payload: '<script>alert(1)</script>', location: 'body', base: { method: 'POST', url: 'http://test.local/api', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' }, paramName: 'name' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const body = (r.value as any).body;
    expect(body).toContain('<script>');
    const parsed = JSON.parse(body);
    expect(parsed.name).toBe('<script>alert(1)</script>');
  });

  it('injects into form body', () => {
    const r = injectInContext.execute(
      { payload: 'test123', location: 'body', base: { method: 'POST', url: 'http://test.local/api', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=alice&email=alice@test.local' }, paramName: 'name' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const body = (r.value as any).body;
    expect(body).toContain('name=test123');
  });

  it('injects into header', () => {
    const r = injectInContext.execute(
      { payload: "' OR 1=1 --", location: 'header', base: { method: 'GET', url: 'http://test.local/api', headers: {} }, paramName: 'X-Forwarded-For' },
      ctx,
    );
    expect((r.value as any).headers['X-Forwarded-For']).toBe("' OR 1=1 --");
  });

  it('injects into cookie', () => {
    const r = injectInContext.execute(
      { payload: 'admin', location: 'cookie', base: { method: 'GET', url: 'http://test.local/api', headers: {}, cookies: { existing: 'val' } }, paramName: 'role' },
      ctx,
    );
    expect((r.value as any).cookies.role).toBe('admin');
    expect((r.value as any).cookies.existing).toBe('val');
  });

  it('injects into path (template substitution)', () => {
    const r = injectInContext.execute(
      { payload: '999', location: 'path', base: { method: 'GET', url: 'http://test.local/api/users/{id}', headers: {} }, paramName: 'id' },
      ctx,
    );
    expect((r.value as any).url).toBe('http://test.local/api/users/999');
  });
});

describe('omitHeader', () => {
  it('removes named header', () => {
    const r = omitHeader.execute({ headers: { Cookie: 'x=1', Authorization: 'Bearer y' }, name: 'Authorization' }, ctx);
    expect((r.value as any).Cookie).toBe('x=1');
    expect((r.value as any).Authorization).toBeUndefined();
  });

  it('case-insensitive removal', () => {
    const r = omitHeader.execute({ headers: { 'X-Custom': 'x', 'x-custom': 'y' }, name: 'X-Custom' }, ctx);
    const v = r.value as any;
    expect(v['X-Custom']).toBeUndefined();
    expect(v['x-custom']).toBeUndefined();
  });
});
