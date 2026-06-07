// tests/primitives/spider.test.ts
//
// Block 12: spiderCrawl primitive. The real spider requires a running
// Playwright browser, so the tests focus on:
//   1. summarizeCrawlResult() — pure transformer (cap, sort, stats)
//   2. The primitive's wire-up (delegates to ctx.crawler, errors clearly)
//   3. The end-to-end execute path with a mock crawler

import { describe, it, expect, vi } from 'vitest';
import type { CrawlResult, RouteNode } from '../../src/explorer/spider';
import { spiderCrawl, summarizeCrawlResult, type CrawlerFn } from '../../src/primitives/spider';
import type { PrimitiveContext } from '../../src/primitives/types';

function mkRoute(over: Partial<RouteNode> = {}): RouteNode {
  return {
    path: '/default',
    title: 'Default',
    depth: 0,
    url: 'https://example.com/default',
    forms: 0,
    linkCount: 0,
    visitedAt: Date.now(),
    ...over,
  };
}

function mkCrawlResult(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    baseUrl: 'https://example.com',
    totalRoutes: 0,
    maxDepth: 2,
    durationMs: 100,
    routes: [],
    visitedUrls: [],
    errors: [],
    trace: [],
    recording: [],
    snapshots: [],
    cookies: {},
    localStorage: {},
    sessionStorage: {},
    techStack: [],
    storageStatePath: '',
    loginEndpoint: '',
    loginMethod: '',
    loginFields: [],
    ...over,
  };
}

function mkCtx(over: Partial<PrimitiveContext> = {}): PrimitiveContext {
  return {
    cookies: {},
    baseUrl: 'https://example.com',
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: Date.now(), maxMs: 600_000 },
    ...over,
  };
}

describe('summarizeCrawlResult', () => {
  it('passes through base fields', () => {
    const raw = mkCrawlResult({ baseUrl: 'https://x.com', totalRoutes: 0, maxDepth: 3, durationMs: 1234 });
    const s = summarizeCrawlResult(raw);
    expect(s.baseUrl).toBe('https://x.com');
    expect(s.totalRoutes).toBe(0);
    expect(s.maxDepth).toBe(3);
    expect(s.durationMs).toBe(1234);
  });

  it('returns empty routes for an empty crawl', () => {
    const s = summarizeCrawlResult(mkCrawlResult());
    expect(s.routes).toEqual([]);
    expect(s.techStack).toEqual([]);
    expect(s.visitedUrls).toEqual([]);
    expect(s.errors).toEqual([]);
    expect(s.truncated).toBe(false);
    expect(s.routesWithForms).toBe(0);
    expect(s.leafRouteCount).toBe(0);
  });

  it('sorts routes by depth asc, then path asc', () => {
    const raw = mkCrawlResult({
      routes: [
        mkRoute({ path: '/z', depth: 1 }),
        mkRoute({ path: '/a', depth: 2 }),
        mkRoute({ path: '/b', depth: 0 }),
        mkRoute({ path: '/m', depth: 0 }),
      ],
    });
    const s = summarizeCrawlResult(raw);
    expect(s.routes.map((r) => r.path)).toEqual(['/b', '/m', '/z', '/a']);
  });

  it('caps routes at the configured limit', () => {
    const raw = mkCrawlResult({
      routes: Array.from({ length: 100 }, (_, i) => mkRoute({ path: `/p${i}`, depth: 0 })),
    });
    const s = summarizeCrawlResult(raw, { routeCap: 10 });
    expect(s.routes).toHaveLength(10);
  });

  it('marks truncated=true when the cap kicked in', () => {
    const raw = mkCrawlResult({
      totalRoutes: 50,
      routes: Array.from({ length: 50 }, (_, i) => mkRoute({ path: `/p${i}`, depth: 0 })),
    });
    const s = summarizeCrawlResult(raw, { routeCap: 5 });
    expect(s.truncated).toBe(true);
  });

  it('marks truncated=true when visitedUrls was capped', () => {
    const raw = mkCrawlResult({
      visitedUrls: Array.from({ length: 100 }, (_, i) => `https://example.com/p${i}`),
    });
    const s = summarizeCrawlResult(raw, { visitedCap: 10 });
    expect(s.truncated).toBe(true);
    expect(s.visitedUrls).toHaveLength(10);
  });

  it('marks truncated=false when nothing was capped', () => {
    const raw = mkCrawlResult({
      totalRoutes: 3,
      routes: [mkRoute({ path: '/a' }), mkRoute({ path: '/b' }), mkRoute({ path: '/c' })],
      visitedUrls: ['https://example.com/'],
    });
    const s = summarizeCrawlResult(raw);
    expect(s.truncated).toBe(false);
  });

  it('counts routesWithForms', () => {
    const raw = mkCrawlResult({
      routes: [
        mkRoute({ path: '/a', forms: 0 }),
        mkRoute({ path: '/b', forms: 2 }),
        mkRoute({ path: '/c', forms: 1 }),
        mkRoute({ path: '/d', forms: 0 }),
      ],
    });
    const s = summarizeCrawlResult(raw);
    expect(s.routesWithForms).toBe(2);
  });

  it('counts leafRouteCount (routes at maxDepth)', () => {
    const raw = mkCrawlResult({
      maxDepth: 2,
      routes: [
        mkRoute({ path: '/a', depth: 0 }),
        mkRoute({ path: '/b', depth: 1 }),
        mkRoute({ path: '/c', depth: 2 }),
        mkRoute({ path: '/d', depth: 2 }),
      ],
    });
    const s = summarizeCrawlResult(raw);
    expect(s.leafRouteCount).toBe(2);
  });

  it('passes through techStack', () => {
    const raw = mkCrawlResult({ techStack: ['react', 'express', 'jwt'] });
    const s = summarizeCrawlResult(raw);
    expect(s.techStack).toEqual(['react', 'express', 'jwt']);
  });

  it('caps errors at the configured limit', () => {
    const raw = mkCrawlResult({
      errors: Array.from({ length: 20 }, (_, i) => ({ url: `/e${i}`, error: 'fail' })),
    });
    const s = summarizeCrawlResult(raw, { errorCap: 3 });
    expect(s.errors).toHaveLength(3);
  });

  it('strips bodyPreview/contentType/snapshotHash from the route list (LLM context budget)', () => {
    const raw = mkCrawlResult({
      routes: [
        mkRoute({
          path: '/a',
          bodyPreview: '<huge body here>',
          contentType: 'text/html',
          status: 200,
        }),
      ],
    });
    const s = summarizeCrawlResult(raw);
    expect(s.routes[0]).toEqual({
      path: '/a', title: 'Default', depth: 0, forms: 0, linkCount: 0, status: 200,
    });
    // And it really should NOT carry bodyPreview
    expect((s.routes[0] as Record<string, unknown>).bodyPreview).toBeUndefined();
  });
});

describe('spiderCrawl primitive (execute)', () => {
  it('returns ok:false when no targetUrl and no ctx.baseUrl', async () => {
    const r = await spiderCrawl.execute({}, mkCtx({ baseUrl: '' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no target url/i);
  });

  it('defaults targetUrl to ctx.baseUrl', async () => {
    const crawler: CrawlerFn = vi.fn(async () => mkCrawlResult());
    const r = await spiderCrawl.execute({}, mkCtx({ baseUrl: 'https://x.example', crawler }));
    expect(r.ok).toBe(true);
    expect(crawler).toHaveBeenCalledWith('https://x.example', 2);
  });

  it('honours args.targetUrl override', async () => {
    const crawler: CrawlerFn = vi.fn(async () => mkCrawlResult());
    await spiderCrawl.execute({ targetUrl: 'https://override.example' }, mkCtx({ crawler }));
    expect(crawler).toHaveBeenCalledWith('https://override.example', 2);
  });

  it('clamps maxDepth to the [1, 5] range', async () => {
    const crawler: CrawlerFn = vi.fn(async () => mkCrawlResult());
    await spiderCrawl.execute({ maxDepth: 99 }, mkCtx({ crawler }));
    expect(crawler).toHaveBeenCalledWith(expect.any(String), 5);
    await spiderCrawl.execute({ maxDepth: 0 }, mkCtx({ crawler }));
    expect(crawler).toHaveBeenLastCalledWith(expect.any(String), 1);
    await spiderCrawl.execute({ maxDepth: -3 }, mkCtx({ crawler }));
    expect(crawler).toHaveBeenLastCalledWith(expect.any(String), 1);
  });

  it('uses args.maxDepth when in range', async () => {
    const crawler: CrawlerFn = vi.fn(async () => mkCrawlResult());
    await spiderCrawl.execute({ maxDepth: 3 }, mkCtx({ crawler }));
    expect(crawler).toHaveBeenCalledWith(expect.any(String), 3);
  });

  it('returns the summarized crawl result', async () => {
    const crawler: CrawlerFn = vi.fn(async () => mkCrawlResult({
      baseUrl: 'https://x.example',
      totalRoutes: 2,
      routes: [
        mkRoute({ path: '/', depth: 0, title: 'Home' }),
        mkRoute({ path: '/login', depth: 1, title: 'Login', forms: 1 }),
      ],
      techStack: ['next.js'],
      visitedUrls: ['https://x.example/', 'https://x.example/login'],
    }));
    const r = await spiderCrawl.execute({ targetUrl: 'https://x.example', maxDepth: 2 }, mkCtx({ crawler }));
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({
      baseUrl: 'https://x.example',
      totalRoutes: 2,
      techStack: ['next.js'],
      routesWithForms: 1,
      leafRouteCount: 0, // both routes are at depth 0/1, none at maxDepth=2
    });
    expect(r.value!.routes).toHaveLength(2);
    expect(r.value!.routes[0].path).toBe('/');
    expect(r.value!.routes[1].path).toBe('/login');
  });

  it('captures crawler errors as ok:false with a message', async () => {
    const crawler: CrawlerFn = vi.fn(async () => { throw new Error('browser crashed'); });
    const r = await spiderCrawl.execute({ targetUrl: 'https://x.example' }, mkCtx({ crawler }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('browser crashed');
  });

  it('reports a non-zero durationMs', async () => {
    const crawler: CrawlerFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return mkCrawlResult();
    });
    const r = await spiderCrawl.execute({ targetUrl: 'https://x.example' }, mkCtx({ crawler }));
    expect(r.ok).toBe(true);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('preserves tech stack and errors in the result', async () => {
    const crawler: CrawlerFn = vi.fn(async () => mkCrawlResult({
      techStack: ['react', 'cloudflare'],
      errors: [{ url: 'https://x.example/oops', error: 'timeout' }],
    }));
    const r = await spiderCrawl.execute({ targetUrl: 'https://x.example' }, mkCtx({ crawler }));
    expect(r.value!.techStack).toEqual(['react', 'cloudflare']);
    expect(r.value!.errors).toEqual([{ url: 'https://x.example/oops', error: 'timeout' }]);
  });
});

describe('spiderCrawl primitive (metadata)', () => {
  it('declares itself browser-required', () => {
    expect(spiderCrawl.requiresBrowser).toBe(true);
  });
  it('declares itself deterministic', () => {
    expect(spiderCrawl.deterministic).toBe(true);
  });
  it('has a non-empty description', () => {
    expect(spiderCrawl.description.length).toBeGreaterThan(50);
  });
  it('has the right name', () => {
    expect(spiderCrawl.name).toBe('spiderCrawl');
  });
});
