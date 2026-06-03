// src/primitives/injection.ts
//
// Injection primitives: injectInContext, omitHeader.
// These transform a request template by placing a payload at a specific
// location (query/body/header/cookie/path/filename) or stripping a header.

import type {
  InjectionLocation,
  PrimitiveContext,
  PrimitiveDefinition,
  PrimitiveRequest,
  PrimitiveResult,
} from './types';

function tryParseJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function escapeQuery(value: string): string {
  return encodeURIComponent(value);
}

export const injectInContext: PrimitiveDefinition<
  {
    payload: string;
    location: InjectionLocation;
    base: PrimitiveRequest;
    /** For path/filename, the param name to substitute (e.g. 'id', 'file') */
    paramName?: string;
  },
  PrimitiveRequest
> = {
  name: 'injectInContext',
  description: 'Take a base request and inject a payload at the specified location. Returns a new request the Composer can pass to httpRequest.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<PrimitiveRequest> {
    const start = Date.now();
    const { payload, location, base } = args;
    const next: PrimitiveRequest = {
      method: base.method,
      url: base.url,
      headers: { ...base.headers },
      body: base.body,
      cookies: base.cookies,
      timeoutMs: base.timeoutMs,
    };

    try {
      switch (location) {
        case 'query': {
          const u = new URL(base.url);
          const key = args.paramName ?? Object.keys(u.searchParams)[0] ?? 'q';
          u.searchParams.set(key, payload);
          next.url = u.toString();
          break;
        }
        case 'body': {
          const json = tryParseJson(typeof base.body === 'string' ? base.body : '');
          if (json) {
            const key = args.paramName ?? Object.keys(json)[0] ?? 'data';
            json[key] = payload;
            next.body = JSON.stringify(json);
            next.headers['content-type'] = 'application/json';
          } else {
            // Treat as form-encoded
            const params = new URLSearchParams(typeof base.body === 'string' ? base.body : '');
            const key = args.paramName ?? Object.keys(Object.fromEntries(params))[0] ?? 'data';
            params.set(key, payload);
            next.body = params.toString();
            next.headers['content-type'] = 'application/x-www-form-urlencoded';
          }
          break;
        }
        case 'header': {
          const key = args.paramName ?? 'X-Custom';
          next.headers[key] = payload;
          break;
        }
        case 'cookie': {
          const key = args.paramName ?? 'session';
          next.cookies = { ...(base.cookies ?? {}), [key]: payload };
          break;
        }
        case 'path': {
          const key = args.paramName ?? 'id';
          // Replace `{key}` template OR the last path segment
          if (next.url.includes(`{${key}}`)) {
            next.url = next.url.replace(`{${key}}`, escapeQuery(payload));
          } else {
            const u = new URL(base.url);
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length > 0) parts[parts.length - 1] = escapeQuery(payload);
            u.pathname = '/' + parts.join('/');
            next.url = u.toString();
          }
          break;
        }
        case 'filename': {
          // Body must be multipart. Caller is expected to have used craftMultipart
          // first; this primitive just returns the base as-is so httpRequest
          // can send it. The filename is already in the body.
          if (typeof next.body === 'string' || Buffer.isBuffer(next.body)) {
            // pass-through
          } else {
            next.body = payload;
          }
          break;
        }
        case 'xml-entity': {
          // The base body should be XML; replace any value with the entity payload
          next.body = payload;
          next.headers['content-type'] = 'application/xml';
          break;
        }
      }

      return {
        ok: true,
        value: next,
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
};

export const omitHeader: PrimitiveDefinition<
  { headers: Record<string, string>; name: string },
  Record<string, string>
> = {
  name: 'omitHeader',
  description: 'Remove a header from a request. Used for CSRF testing (omit Cookie/Authorization to confirm the request still succeeds).',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<Record<string, string>> {
    const start = Date.now();
    const next: Record<string, string> = {};
    const target = args.name.toLowerCase();
    for (const [k, v] of Object.entries(args.headers)) {
      if (k.toLowerCase() !== target) next[k] = v;
    }
    return {
      ok: true,
      value: next,
      durationMs: Date.now() - start,
    };
  },
};
