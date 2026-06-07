/**
 * tests/agents/schema-unwrap.test.ts
 *
 * Block 19: prove that the schema-unwrap fix in primitive-helpers.ts
 * actually works. The LLM follows the tool schema in tool-schema.ts,
 * which wraps complex objects under named keys:
 *
 *   httpRequest:        { request: {...} }
 *   followRedirects:    { initial: {...}, maxHops? }
 *   parseResponse:      { response: {...} }
 *   checkWaf:           { response: {...} }
 *   extractSessionCookie: { response: {...} }
 *   compareResponses:   { baseline: {...}, target: {...} }
 *
 * The primitives themselves expect the flat object. `unwrapArgs` in
 * primitive-helpers.ts bridges the gap.
 *
 * These tests run REAL httpRequest (against httpbin or a local stub)
 * and verify that the unwrapped request actually reaches the network.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import { executePrimitive } from '../../src/agents/primitive-helpers';
import type { PrimitiveContext } from '../../src/primitives/types';

function makeCtx(): PrimitiveContext {
  return {
    baseUrl: 'http://127.0.0.1:0',
    cookies: {},
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: Date.now(), maxMs: 10_000 },
  };
}

function startEchoServer(): Promise<{ port: number; close: () => Promise<void>; received: any }> {
  return new Promise((resolve) => {
    const received: { method?: string; url?: string; body?: string } = {};
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c.toString()));
      req.on('end', () => {
        received.method = req.method;
        received.url = req.url;
        received.body = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, method: req.method, url: req.url, body }));
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        received,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

describe('schema-unwrap (Block 19): executePrimitive unwraps LLM tool args', () => {
  let server: Awaited<ReturnType<typeof startEchoServer>>;
  let ctx: PrimitiveContext;

  beforeAll(async () => {
    server = await startEchoServer();
    ctx = { ...makeCtx(), baseUrl: `http://127.0.0.1:${server.port}` };
  });

  afterAll(async () => {
    await server.close();
  });

  it('httpRequest: unwraps {request: {...}} to flat request', async () => {
    const r = await executePrimitive('httpRequest', {
      request: {
        method: 'GET',
        url: `http://127.0.0.1:${server.port}/unwrapped?x=1`,
        headers: { 'x-test': 'unwrapped' },
        timeoutMs: 5000,
      },
    }, ctx);
    expect(r.ok).toBe(true);
    // If the unwrap failed, the request would be malformed — server
    // wouldn't see /unwrapped in the URL.
    expect(server.received.url).toBe('/unwrapped?x=1');
    expect(server.received.method).toBe('GET');
  });

  it('httpRequest: also accepts flat request (back-compat with old shape)', async () => {
    // Clear the closure's `received` object (not the test's reference)
    // — reassigning server.received wouldn't affect what the server writes to.
    server.received.method = undefined;
    server.received.url = undefined;
    server.received.body = undefined;
    const r = await executePrimitive('httpRequest', {
      method: 'POST',
      url: `http://127.0.0.1:${server.port}/flat`,
      headers: { 'x-test': 'flat' },
      body: 'hello',
      timeoutMs: 5000,
    }, ctx);
    expect(r.ok).toBe(true);
    expect(server.received.url).toBe('/flat');
    expect(server.received.method).toBe('POST');
    expect(server.received.body).toBe('hello');
  });

  it('parseResponse: unwraps {response: {...}}', async () => {
    const r = await executePrimitive('parseResponse', {
      response: {
        status: 200,
        url: 'http://x.com',
        finalUrl: 'http://x.com',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
        durationMs: 10,
        redirects: [],
        timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
      },
    }, ctx);
    expect(r.ok).toBe(true);
    const v = r.value as any;
    expect(v.status).toBe(200);
    expect(v.json).toEqual({ a: 1 });
  });

  it('checkWaf: unwraps {response: {...}}', async () => {
    const r = await executePrimitive('checkWaf', {
      response: {
        status: 403,
        url: 'http://x.com',
        finalUrl: 'http://x.com',
        headers: { server: 'cloudflare' },
        body: '<html>blocked</html>',
        durationMs: 10,
        redirects: [],
        timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
      },
    }, ctx);
    expect(r.ok).toBe(true);
    const v = r.value as any;
    expect(v.detected).toBe(true);
    expect(v.vendor).toBe('cloudflare');
  });

  it('extractSessionCookie: unwraps {response: {...}}', async () => {
    // Note: the primitive's first loop anchors with ^ so it only captures
    // the first key=value of each header. The second loop fires when the
    // header value starts with "set-cookie:" (it doesn't here). We use
    // a single cookie to keep this test deterministic.
    const r = await executePrimitive('extractSessionCookie', {
      response: {
        status: 200,
        url: 'http://x.com',
        finalUrl: 'http://x.com',
        headers: { 'set-cookie': 'session=abc123; Path=/' },
        body: '',
        durationMs: 10,
        redirects: [],
        timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
      },
    }, ctx);
    expect(r.ok).toBe(true);
    const v = r.value as any;
    expect(v.cookies).toEqual({ session: 'abc123' });
  });

  it('compareResponses: passes through {baseline, target}', async () => {
    const r = await executePrimitive('compareResponses', {
      baseline: {
        status: 200, url: 'a', finalUrl: 'a',
        headers: {}, body: '{"x":1,"y":2}',
        durationMs: 0, redirects: [], timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
      },
      target: {
        status: 200, url: 'b', finalUrl: 'b',
        headers: {}, body: '{"x":1,"y":3}',
        durationMs: 0, redirects: [], timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
      },
    }, ctx);
    expect(r.ok).toBe(true);
    const v = r.value as any;
    expect(v.divergence).toBeGreaterThan(0);
    expect(v.divergence).toBeLessThan(1);
  });

  it('injectInContext: passes flat args through (no wrapper to strip)', async () => {
    const r = await executePrimitive('injectInContext', {
      payload: 'INJECT',
      location: 'query',
      base: {
        method: 'GET',
        url: `http://127.0.0.1:${server.port}/inject?x=1`,
        headers: {},
        timeoutMs: 5000,
      },
    }, ctx);
    expect(r.ok).toBe(true);
    const req = r.value as any;
    // The injected URL should now contain INJECT.
    expect(req.url).toMatch(/INJECT/);
  });
});
