// src/primitives/http.ts
//
// HTTP-layer primitives: httpRequest, multipartUpload, followRedirects.
// These wrap Node's native fetch with normalized inputs/outputs, response
// timing breakdown, and (for followRedirects) a hop-by-hop log so the
// Composer can distinguish server-side 302s from client-side meta-refresh/JS.

import type {
  PrimitiveContext,
  PrimitiveDefinition,
  PrimitiveRequest,
  PrimitiveResponse,
  PrimitiveResult,
} from './types';

function buildHeaders(req: PrimitiveRequest, cookies: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...req.headers };
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  if (cookieStr) headers['cookie'] = cookieStr;
  return headers;
}

function buildTiming(start: number, fetchStart: number, res: Response): PrimitiveResponse['timing'] {
  const end = performance.now();
  // Note: precise breakdown needs a low-level HTTP trace; this is a best-effort.
  const total = end - start;
  return {
    dns: 0,
    connect: 0,
    tls: 0,
    ttfb: fetchStart - start,
    download: end - fetchStart,
  };
}

async function executeRequest(
  req: PrimitiveRequest,
  cookies: Record<string, string>,
): Promise<{ response: PrimitiveResponse; raw: Response }> {
  const headers = buildHeaders(req, cookies);
  const start = performance.now();
  const fetchStart = start;

  const fetchOpts: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(req.timeoutMs ?? 10_000),
  };
  if (req.body !== undefined) {
    fetchOpts.body = req.body as BodyInit;
  }

  const raw = await fetch(req.url, fetchOpts);
  const body = await raw.text();
  const resHeaders: Record<string, string> = {};
  raw.headers.forEach((v, k) => { resHeaders[k] = v; });

  const response: PrimitiveResponse = {
    status: raw.status,
    url: req.url,
    finalUrl: req.url,
    headers: resHeaders,
    body,
    durationMs: performance.now() - start,
    redirects: [],
    timing: buildTiming(start, fetchStart, raw),
  };
  return { response, raw };
}

export const httpRequest: PrimitiveDefinition<PrimitiveRequest, PrimitiveResponse> = {
  name: 'httpRequest',
  description: 'Execute a single HTTP request with the given method/headers/body/cookies. Does NOT follow redirects — use followRedirects for that.',
  requiresBrowser: false,
  deterministic: true,
  async execute(req, ctx): Promise<PrimitiveResult<PrimitiveResponse>> {
    const start = performance.now();
    try {
      const { response } = await executeRequest(req, ctx.cookies);
      return {
        ok: true,
        value: response,
        durationMs: performance.now() - start,
      };
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message,
        durationMs: performance.now() - start,
      };
    }
  },
};

export const multipartUpload: PrimitiveDefinition<
  { url: string; filename: string; contentType: string; content: Buffer | string; headers?: Record<string, string> },
  PrimitiveResponse
> = {
  name: 'multipartUpload',
  description: 'Upload a file via multipart/form-data. Used for file-upload attack testing (path traversal in filename, SVG XSS, etc.).',
  requiresBrowser: false,
  deterministic: true,
  async execute(args, ctx): Promise<PrimitiveResult<PrimitiveResponse>> {
    const start = performance.now();
    try {
      const formData = new FormData();
      const contentBuf = Buffer.isBuffer(args.content) ? args.content : Buffer.from(args.content, 'utf-8');
      const blobParts: BlobPart[] = [new Uint8Array(contentBuf)];
      const blob = new Blob(blobParts, { type: args.contentType });
      formData.append('file', blob, args.filename);
      const headers = buildHeaders(
        { method: 'POST', url: args.url, headers: args.headers ?? {}, cookies: ctx.cookies },
        ctx.cookies,
      );
      // Remove Content-Type so the runtime sets the boundary
      delete headers['content-type'];
      delete headers['Content-Type'];
      const raw = await fetch(args.url, {
        method: 'POST',
        headers,
        body: formData,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      const body = await raw.text();
      const resHeaders: Record<string, string> = {};
      raw.headers.forEach((v, k) => { resHeaders[k] = v; });
      return {
        ok: true,
        value: {
          status: raw.status,
          url: args.url,
          finalUrl: args.url,
          headers: resHeaders,
          body,
          durationMs: performance.now() - start,
          redirects: [],
          timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
        },
        durationMs: performance.now() - start,
      };
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message,
        durationMs: performance.now() - start,
      };
    }
  },
};

export const followRedirects: PrimitiveDefinition<
  { initial: PrimitiveResponse; maxHops?: number },
  PrimitiveResponse
> = {
  name: 'followRedirects',
  description: 'Follow 3xx redirects from an initial response. Tracks the redirect chain and returns the final response.',
  requiresBrowser: false,
  deterministic: true,
  async execute(args, ctx): Promise<PrimitiveResult<PrimitiveResponse>> {
    const start = performance.now();
    const maxHops = args.maxHops ?? 5;
    let current: PrimitiveResponse = args.initial;
    const redirectChain: string[] = [];
    let hops = 0;
    try {
      while (hops < maxHops && current.status >= 300 && current.status < 400) {
        const location = current.headers['location'] || current.headers['Location'];
        if (!location) break;
        redirectChain.push(location);
        const nextUrl = new URL(location, current.url).toString();
        const next: PrimitiveRequest = {
          method: 'GET',
          url: nextUrl,
          headers: {},
        };
        const { response } = await executeRequest(next, ctx.cookies);
        current = response;
        current.finalUrl = nextUrl;
        current.redirects = redirectChain;
        hops++;
      }
      return {
        ok: true,
        value: current,
        durationMs: performance.now() - start,
      };
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message,
        durationMs: performance.now() - start,
      };
    }
  },
};
