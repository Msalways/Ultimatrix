// src/primitives/spider.ts
//
// Block 12: spiderCrawl primitive. Gives the LLM a tool to call the
// real Playwright spider (src/explorer/spider.ts) and get a concise
// list of discovered routes + tech stack back. The full CrawlResult
// would blow the agent's context window, so we summarize it down to
// a compact result the LLM can read in one turn.
//
// Design notes:
//   - The primitive uses the shared browser manager (same as
//     evaluateRendered in observation.ts) so it stays in one Playwright
//     context per run.
//   - For tests, the actual crawl is pluggable: if `ctx.crawler` is
//     set, we use it instead of spinning up a real SpiderCrawler.
//   - The result is capped (default 30 routes) and stripped of
//     heavy fields (no full body previews, no DOM snapshots) so the
//     LLM can read the whole thing in one turn.

import type { CrawlResult } from '../explorer/spider';
import type {
  PrimitiveContext,
  PrimitiveDefinition,
  PrimitiveResult,
} from './types';

export interface SpiderCrawlArgs {
  /** Target URL to start crawling. Defaults to ctx.baseUrl. */
  targetUrl?: string;
  /** Max depth (1 = just the start page, 2 = links from start, etc.). Default 2. */
  maxDepth?: number;
}

export interface SpiderCrawlRoute {
  path: string;
  title: string;
  depth: number;
  forms: number;
  linkCount: number;
  status?: number;
}

export interface SpiderCrawlPrimitiveResult {
  baseUrl: string;
  totalRoutes: number;
  maxDepth: number;
  durationMs: number;
  /** Capped list of routes (sorted by depth asc, then path asc). */
  routes: SpiderCrawlRoute[];
  /** Tech stack fingerprints detected. */
  techStack: string[];
  /** First N visited URLs (capped, default 30). */
  visitedUrls: string[];
  /** Crawl errors (capped, default 5). */
  errors: Array<{ url: string; error: string }>;
  /** True when the cap kicked in and the agent should know more existed. */
  truncated: boolean;
  /** Quick stat: how many routes had at least one form on them. */
  routesWithForms: number;
  /** Quick stat: how many routes were at the requested max depth. */
  leafRouteCount: number;
}

export type CrawlerFn = (targetUrl: string, maxDepth: number) => Promise<CrawlResult>;

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_ROUTE_CAP = 30;
const DEFAULT_VISITED_CAP = 30;
const DEFAULT_ERROR_CAP = 5;

/** Build a SpiderCrawlPrimitiveResult from a full CrawlResult. Pure / testable. */
export function summarizeCrawlResult(
  raw: CrawlResult,
  opts: { routeCap?: number; visitedCap?: number; errorCap?: number } = {},
): SpiderCrawlPrimitiveResult {
  const routeCap = opts.routeCap ?? DEFAULT_ROUTE_CAP;
  const visitedCap = opts.visitedCap ?? DEFAULT_VISITED_CAP;
  const errorCap = opts.errorCap ?? DEFAULT_ERROR_CAP;

  // Sort: shallow routes first (more interesting to LLM as entry points),
  // then alphabetical path for stability.
  const sorted = raw.routes.slice().sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.path.localeCompare(b.path);
  });
  const cappedRoutes = sorted.slice(0, routeCap);
  const routes: SpiderCrawlRoute[] = cappedRoutes.map((r) => ({
    path: r.path,
    title: r.title,
    depth: r.depth,
    forms: r.forms,
    linkCount: r.linkCount,
    status: r.status,
  }));

  return {
    baseUrl: raw.baseUrl,
    totalRoutes: raw.totalRoutes,
    maxDepth: raw.maxDepth,
    durationMs: raw.durationMs,
    routes,
    techStack: raw.techStack ?? [],
    visitedUrls: raw.visitedUrls.slice(0, visitedCap),
    errors: raw.errors.slice(0, errorCap),
    truncated: raw.totalRoutes > routes.length || raw.visitedUrls.length > visitedCap,
    routesWithForms: raw.routes.filter((r) => r.forms > 0).length,
    leafRouteCount: raw.routes.filter((r) => r.depth === raw.maxDepth).length,
  };
}

/** Build a real SpiderCrawler-based crawl function. Used as the default. */
export function defaultCrawlFn(): CrawlerFn {
  return async (targetUrl, maxDepth) => {
    const { SpiderCrawler } = await import('../explorer/spider');
    const { getSharedBrowserManager } = await import('../tools/browser-tools');
    const mgr = getSharedBrowserManager(true);
    const crawler = new SpiderCrawler(mgr, `spider-${Date.now()}`);
    return crawler.crawl(targetUrl, maxDepth);
  };
}

export const spiderCrawl: PrimitiveDefinition<SpiderCrawlArgs, SpiderCrawlPrimitiveResult> = {
  name: 'spiderCrawl',
  description:
    'Run the Playwright-driven spider starting from a URL. Returns a compact list of discovered routes (path, title, depth, form count, link count), the detected tech stack, the first N visited URLs, and any crawl errors. Use this to find attack surface you don\'t know about — the LLM-driven composer can then craft probes against the discovered endpoints. Heavier than httpRequest (opens a headless browser); call sparingly.',
  requiresBrowser: true,
  deterministic: true,
  async execute(args, ctx): Promise<PrimitiveResult<SpiderCrawlPrimitiveResult>> {
    const start = Date.now();
    const targetUrl = args.targetUrl || ctx.baseUrl;
    const maxDepth = Math.max(1, Math.min(5, args.maxDepth ?? DEFAULT_MAX_DEPTH));
    if (!targetUrl) {
      return {
        ok: false,
        error: 'no target URL: pass args.targetUrl or set ctx.baseUrl',
        durationMs: Date.now() - start,
      };
    }
    try {
      const crawl = ctx.crawler ?? defaultCrawlFn();
      const raw = await crawl(targetUrl, maxDepth);
      const summary = summarizeCrawlResult(raw);
      return {
        ok: true,
        value: summary,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message,
        durationMs: Date.now() - start,
      };
    }
  },
  toPlaywrightStep(args, result) {
    if (!result.ok) return null;
    const r = result.value as SpiderCrawlPrimitiveResult | undefined;
    if (!r || !r.routes || r.routes.length === 0) return null;
    const firstRoute = r.routes[0];
    return {
      action: `await page.goto('${firstRoute.path.startsWith('http') ? firstRoute.path : (args as any).targetUrl ?? ''}${firstRoute.path}', { waitUntil: 'load' })`,
      description: `Spider discovered ${r.routes.length} routes (${r.visitedUrls?.length ?? 0} URLs visited)`,
    };
  },
};
