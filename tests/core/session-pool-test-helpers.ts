/**
 * tests/core/session-pool-test-helpers.ts
 *
 * Mock Playwright types and a BrowserFactory that returns in-memory
 * browser/context/page objects. Used by session-pool.test.ts so tests
 * never spin up real Chromium.
 */

import { vi } from 'vitest';

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface ResponseShape {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export interface MockResponse extends ResponseShape {
  status(): number;
  text(): Promise<string>;
  headersArray(): Array<{ name: string; value: string }>;
  url(): string;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface MockContext {
  id: string;
  cookies: Cookie[];
  responseMap: Map<string, ResponseShape>;
  lastRequest?: RecordedRequest;
  nextFetchThrows?: boolean;
  setResponse(method: string, url: string, resp: { status: number; body: string; headers?: Record<string, string> }): void;
  setCookies(cookies: Cookie[]): void;
  request: { fetch: (url: string, opts?: { method?: string; headers?: Record<string, string>; data?: string; timeout?: number }) => Promise<MockResponse> };
  page: { screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<void> };
  context: { cookies: () => Promise<Cookie[]>; close: () => Promise<void>; request: any };
  browser: { close: () => Promise<void> };
}

function makeMockResponse(url: string, resp: ResponseShape): MockResponse {
  const statusValue = resp.status;
  const bodyValue = resp.body;
  const headersValue = resp.headers;
  return {
    status() { return statusValue; },
    async text() { return bodyValue; },
    headersArray() {
      return Object.entries(headersValue).map(([name, value]) => ({ name, value }));
    },
    url() { return url; },
  };
}

interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
}

function makeMockContext(id: string, map: Map<string, MockContext>): MockContext {
  const responseMap = new Map<string, ResponseShape>();
  const cookies: Cookie[] = [];
  const ctx: MockContext = {
    id,
    cookies,
    responseMap,
    setResponse(method, url, resp) {
      responseMap.set(`${method.toUpperCase()} ${url}`, {
        status: resp.status,
        body: resp.body,
        headers: resp.headers ?? {},
      });
    },
    setCookies(c) {
      cookies.length = 0;
      cookies.push(...c);
    },
    lastRequest: undefined,
    nextFetchThrows: false,
    request: {
      async fetch(url, opts = {}) {
        if (ctx.nextFetchThrows) {
          ctx.nextFetchThrows = false;
          throw new Error('simulated network failure');
        }
        const method = (opts.method ?? 'GET').toUpperCase();
        ctx.lastRequest = { url, method, headers: opts.headers ?? {}, body: opts.data };
        const key = `${method} ${url}`;
        const resp = responseMap.get(key);
        if (!resp) {
          return makeMockResponse(url, {
            status: 404,
            body: `mock 404 for ${key}`,
            headers: { 'content-type': 'text/plain' },
          });
        }
        return makeMockResponse(url, resp);
      },
    },
    page: {
      async screenshot(opts) {
        const fs = await import('fs');
        const path = await import('path');
        fs.mkdirSync(path.dirname(opts.path), { recursive: true });
        fs.writeFileSync(opts.path, Buffer.from('mock-screenshot-bytes'));
      },
    },
    context: {
      async cookies() {
        return cookies;
      },
      request: undefined as any,
      async close() {
        map.delete(`${id}-browser`);
      },
    },
    browser: {
      async close() {
        map.delete(`${id}-browser`);
      },
    },
  };
  (ctx.context as any).request = ctx.request;
  return ctx;
}

export function makeMockBrowserFactory(trackIn: Map<string, MockContext>) {
  return {
    async launch(options: { sessionId: string; userAgent?: string; viewport?: { width: number; height: number } }) {
      const sessionId = options.sessionId;
      const ctx = makeMockContext(sessionId, trackIn);
      trackIn.set(`${sessionId}-browser`, ctx);
      const browser = {
        close: async () => {
          trackIn.delete(`${sessionId}-browser`);
        },
      };
      const browserCtx = {
        cookies: ctx.context.cookies,
        request: ctx.request,
        close: ctx.context.close,
      };
      const page = {
        screenshot: ctx.page.screenshot,
      };
      return {
        browser: browser as unknown as Browser,
        context: browserCtx as unknown as BrowserContext,
        page: page as unknown as Page,
      };
    },
  };
}

export interface Browser {
  close: () => Promise<void>;
}
export interface BrowserContext {
  cookies: () => Promise<Cookie[]>;
  request: any;
  close: () => Promise<void>;
}
export interface Page {
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<void>;
}

export type { BrowserFactory } from '../../src/core/session-pool';

export { vi };
