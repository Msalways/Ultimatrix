// tests/cli/endpoint-diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffEndpoints, applyEndpointDiff } from '../../src/cli/endpoint-diff';
import type { AppModelEndpoint } from '../../src/core/app-model';

function ep(method: string, path: string, opts: Partial<AppModelEndpoint> = {}): AppModelEndpoint {
  return {
    path,
    method,
    params: opts.params ?? [],
    requiresAuth: opts.requiresAuth ?? false,
    responseStatus: opts.responseStatus ?? 200,
    contentType: opts.contentType ?? 'text/html',
    bodyPreview: opts.bodyPreview ?? '',
  };
}

describe('endpoint diff', () => {
  it('classifies new URLs as created', () => {
    const before: AppModelEndpoint[] = [ep('GET', '/')];
    const after: AppModelEndpoint[] = [ep('GET', '/'), ep('GET', '/login')];
    const d = diffEndpoints(before, after);
    expect(d.created.map((e) => e.path)).toEqual(['/login']);
    expect(d.unchanged.length).toBe(1);
    expect(d.updated.length).toBe(0);
    expect(d.removed.length).toBe(0);
  });

  it('classifies existing URLs with changed body as updated', () => {
    const before: AppModelEndpoint[] = [ep('GET', '/api/users', { bodyPreview: 'old' })];
    const after: AppModelEndpoint[] = [ep('GET', '/api/users', { bodyPreview: 'new' })];
    const d = diffEndpoints(before, after);
    expect(d.updated.length).toBe(1);
    expect(d.updated[0].changedKeys).toContain('bodyPreview');
    expect(d.unchanged.length).toBe(0);
  });

  it('classifies existing URLs with changed params as updated', () => {
    const before: AppModelEndpoint[] = [ep('GET', '/api/users', { params: [{ name: 'id', type: 'string', required: true }] })];
    const after: AppModelEndpoint[] = [ep('GET', '/api/users', { params: [{ name: 'id', type: 'number', required: true }] })];
    const d = diffEndpoints(before, after);
    expect(d.updated.length).toBe(1);
    expect(d.updated[0].changedKeys).toContain('params');
  });

  it('classifies matching URLs as unchanged when body + params match', () => {
    const before: AppModelEndpoint[] = [ep('GET', '/api/users', { bodyPreview: 'hello', params: [{ name: 'q', type: 'string', required: false }] })];
    const after: AppModelEndpoint[] = [ep('GET', '/api/users', { bodyPreview: 'hello', params: [{ name: 'q', type: 'string', required: false }] })];
    const d = diffEndpoints(before, after);
    expect(d.unchanged.length).toBe(1);
    expect(d.updated.length).toBe(0);
  });

  it('treats different methods as different endpoints', () => {
    const before: AppModelEndpoint[] = [ep('GET', '/api/users')];
    const after: AppModelEndpoint[] = [ep('GET', '/api/users'), ep('POST', '/api/users')];
    const d = diffEndpoints(before, after);
    expect(d.created.length).toBe(1);
    expect(d.created[0].method).toBe('POST');
  });

  it('reports removed paths but does not auto-delete them', () => {
    const before: AppModelEndpoint[] = [ep('GET', '/'), ep('GET', '/old')];
    const after: AppModelEndpoint[] = [ep('GET', '/')];
    const d = diffEndpoints(before, after);
    expect(d.removed).toEqual(['GET /old']);
  });

  it('applyEndpointDiff adds created + replaces updated', () => {
    const before: AppModelEndpoint[] = [ep('GET', '/', { bodyPreview: 'a' })];
    const after: AppModelEndpoint[] = [ep('GET', '/', { bodyPreview: 'b' }), ep('GET', '/new')];
    const d = diffEndpoints(before, after);
    const { next, summary } = applyEndpointDiff(before, d);
    expect(next.length).toBe(2);
    expect(next.find((e) => e.path === '/')?.bodyPreview).toBe('b'); // updated
    expect(next.find((e) => e.path === '/new')).toBeDefined(); // created
    expect(summary).toMatch(/created/);
    expect(summary).toMatch(/updated/);
  });
});
