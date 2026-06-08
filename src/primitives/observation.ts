// src/primitives/observation.ts
//
// Observation primitives: parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse, extractSessionCookie, extractCsrfToken.

import type {
  PrimitiveContext,
  PrimitiveDefinition,
  PrimitiveRequest,
  PrimitiveResponse,
  PrimitiveResult,
  WafVendor,
} from './types';
import { httpRequest } from './http';

const WAF_SIGNATURES: Array<{ vendor: WafVendor; patterns: RegExp[] }> = [
  {
    vendor: 'cloudflare',
    patterns: [/cloudflare/i, /cf-ray/i, /__cfduid/i, /cf-cache-status/i],
  },
  {
    vendor: 'akamai',
    patterns: [/akamai/i, /akamai-ghost/i, /x-akamai/i],
  },
  {
    vendor: 'aws-waf',
    patterns: [/awselb/i, /x-amz-cf-id/i, /aws-waf/i],
  },
  {
    vendor: 'imperva',
    patterns: [/imperva/i, /incapsula/i, /x-iinfo/i],
  },
  {
    vendor: 'modsecurity',
    patterns: [/mod_security/i, /modsecurity/i, /x-mod-security/i],
  },
  {
    vendor: 'fastly',
    patterns: [/fastly/i, /x-fastly/i, /x-served-by:\s*fastly/i],
  },
  {
    vendor: 'barracuda',
    patterns: [/barracuda/i, /barra/i],
  },
  {
    vendor: 'f5-bigip',
    patterns: [/f5-bigip/i, /bigip/i, /x-wa-info/i],
  },
  {
    vendor: 'sucuri',
    patterns: [/sucuri/i, /x-sucuri/i, /cloudproxy/i],
  },
  {
    vendor: 'wordfence',
    patterns: [/wordfence/i],
  },
];

export const parseResponse: PrimitiveDefinition<PrimitiveResponse, {
  status: number;
  body: string;
  headers: Record<string, string>;
  json: unknown;
  dom: string;
  textSnippets: string[];
}> = {
  name: 'parseResponse',
  description: 'Normalize a PrimitiveResponse: extract JSON, collect text snippets for later matching, capture DOM as string.',
  requiresBrowser: false,
  deterministic: true,
  execute(res, _ctx): PrimitiveResult<{
    status: number;
    body: string;
    headers: Record<string, string>;
    json: unknown;
    dom: string;
    textSnippets: string[];
  }> {
    const start = Date.now();
    let json: unknown = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
    const textSnippets: string[] = [];
    // Pull out 200-char windows around every "data" or "value" key for later matching
    if (json && typeof json === 'object') {
      const walk = (obj: unknown, path: string[] = []): void => {
        if (obj === null || obj === undefined) return;
        if (typeof obj === 'string') {
          textSnippets.push(obj.slice(0, 200));
          return;
        }
        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) walk(obj[i], [...path, String(i)]);
          return;
        }
        if (typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) walk(v, [...path, k]);
        }
      };
      walk(json);
    }
    return {
      ok: true,
      value: {
        status: res.status,
        body: res.body,
        headers: res.headers,
        json,
        dom: res.body, // For non-browser-rendered responses, the body IS the DOM
        textSnippets,
      },
      durationMs: Date.now() - start,
    };
  },
};

export const evaluateRendered: PrimitiveDefinition<
  { url: string; payload: string; matchMode?: 'exact' | 'unescaped' | 'event-fires' },
  { rendered: boolean; matchType: string; body: string }
> = {
  name: 'evaluateRendered',
  description: 'Open a URL in a Playwright browser, inject the payload into the query, and check if it appears in the rendered DOM. The "real" XSS check — not the response body.',
  requiresBrowser: true,
  deterministic: true,
  async execute(args, ctx): Promise<PrimitiveResult<{ rendered: boolean; matchType: string; body: string }>> {
    const start = Date.now();
    try {
      // Dynamic import to avoid loading Playwright when not needed
      const { getSharedBrowserManager } = await import('../tools/browser-tools');
      const mgr = getSharedBrowserManager(true);
      const page = await mgr.getOrCreate('evaluator');

      // Split URL and inject payload into the query parameter.
      // If the URL already has a query param, use its name.
      // If no param exists, try injecting into common XSS-relevant param
      // names first ('query', 'q', 'search', 'input', 'name', 'id', 's'),
      // falling back to 'q' as last resort. xss-game uses 'query', OWASP
      // juice shop uses 'q', etc. — we try them all in order.
      const u = new URL(args.url);
      const existingParam = u.searchParams.keys().next().value;
      if (existingParam) {
        u.searchParams.set(existingParam, args.payload);
      } else {
        const COMMON_PARAMS = ['query', 'q', 'search', 'input', 'name', 'id', 's', 'text', 'keyword', 'term'];
        u.searchParams.set(COMMON_PARAMS[0], args.payload);
      }

      await page.goto(u.toString(), { waitUntil: 'load' });
      const dom = await page.evaluate<string>('document.documentElement.outerHTML');
      const lower = dom.toLowerCase();
      const lowerPayload = args.payload.toLowerCase();

      // Check for various rendering states
      const exact = lower.includes(lowerPayload);
      const unescaped = !lower.includes(encodeURIComponent(args.payload)) && exact;
      const eventFires = /onerror\s*=|onload\s*=|onclick\s*=|ontoggle\s*=/.test(dom) &&
        /alert|prompt|confirm|fetch\(|eval\(/.test(dom);

      let matchType: 'none' | 'exact' | 'unescaped' | 'event-fires' | 'unknown' = 'none';
      if (eventFires) matchType = 'event-fires';
      else if (unescaped) matchType = 'unescaped';
      else if (exact) matchType = 'exact';

      // Auto-record evidence when reflection is detected. This ensures
      // the triage LLM sees actual DOM content (not just the agent's
      // self-reported claim) when writeFinding is called later.
      if (matchType !== 'none' && ctx) {
        ctx.evidenceLog.push({
          type: 'text',
          data: `matchType=${matchType}\nurl=${u.toString()}\npayload=${args.payload}\nbody_snippet=${dom.slice(0, 500)}`,
          label: `evaluateRendered/${matchType}`,
          timestamp: Date.now(),
          session: ctx.sessionRole,
        });
      }

      return {
        ok: true,
        value: { rendered: exact, matchType, body: dom },
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
    const a = args as { url?: string; payload?: string; matchMode?: string };
    if (!result.ok || !a.url) return null;
    const v = result.value as { matchType?: string } | undefined;
    if (!v || v.matchType === 'none') {
      return {
        action: `await page.goto('${a.url}', { waitUntil: 'load' })`,
        assertion: `await expect(page.locator('body')).not.toContainText('${(a.payload || '').replace(/'/g, "\\'")}')`,
        description: `Verify payload NOT reflected at ${new URL(a.url).pathname}`,
      };
    }
    return {
      action: `await page.goto('${a.url}', { waitUntil: 'load' })`,
      assertion: `await expect(page.locator('body')).toContainText('${(a.payload || '').replace(/'/g, "\\'")}')`,
      description: `Verify XSS: payload ${v.matchType} in DOM at ${new URL(a.url).pathname}`,
    };
  },
};

export const measureTiming: PrimitiveDefinition<
  { url: string; baseline: number; payload: string; iterations?: number; paramName?: string; method?: string },
  { timingDeltaMs: number; vulnerable: boolean; samples: number[] }
> = {
  name: 'measureTiming',
  description: 'Time-based blind detection. Run baseline (no payload) N times, then payload N times, and report the median delta. >3s delta on time-based payloads = vulnerable.',
  requiresBrowser: false,
  deterministic: true,
  async execute(args, _ctx): Promise<PrimitiveResult<{ timingDeltaMs: number; vulnerable: boolean; samples: number[] }>> {
    const start = Date.now();
    const iters = args.iterations ?? 3;
    const samples: number[] = [];
    try {
      for (let i = 0; i < iters; i++) {
        const u = new URL(args.url);
        const key = args.paramName ?? u.searchParams.keys().next().value ?? 'q';
        u.searchParams.set(key, args.payload);
        const t0 = Date.now();
        await fetch(u.toString(), { method: args.method ?? 'GET', redirect: 'manual' });
        samples.push(Date.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)];
      const delta = median - args.baseline;
      return {
        ok: true,
        value: {
          timingDeltaMs: delta,
          vulnerable: delta > 1500, // >1.5s over baseline = likely time-based injection
          samples,
        },
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

function jsonBytes(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf-8');
}

function normalizeJson(obj: unknown, ignoreKeys: string[]): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((v) => normalizeJson(v, ignoreKeys));
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (ignoreKeys.includes(k)) continue;
      out[k] = normalizeJson(v, ignoreKeys);
    }
    return out;
  }
  return obj;
}

function jaccard(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 1;
  const lenDelta = Math.abs(aLen - bLen) / Math.max(aLen, bLen);
  let sameChars = 0;
  const minLen = Math.min(aLen, bLen);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) sameChars++;
  }
  const charSim = sameChars / maxSentinel(minLen);
  return Math.min(1, lenDelta * 0.5 + (1 - charSim) * 0.5);
}

function maxSentinel(n: number): number { return n === 0 ? 1 : n; }

export const compareResponses: PrimitiveDefinition<
  { baseline: PrimitiveResponse; target: PrimitiveResponse; ignoreKeys?: string[] },
  { divergence: number; vulnerable: boolean; baselineBytes: number; targetBytes: number }
> = {
  name: 'compareResponses',
  description: 'Compare two responses: status, body size, and (if both JSON) normalized structural divergence. 0 = identical, 1 = fully different.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<{ divergence: number; vulnerable: boolean; baselineBytes: number; targetBytes: number }> {
    const start = Date.now();
    const ignore = args.ignoreKeys ?? ['timestamp', 'request_id', 'traceId', 'trace_id', 'nonce'];
    const baseJson = tryParseJsonSafe(args.baseline.body);
    const targetJson = tryParseJsonSafe(args.target.body);
    let divergence: number;

    if (baseJson !== null && targetJson !== null) {
      const a = normalizeJson(baseJson, ignore);
      const b = normalizeJson(targetJson, ignore);
      divergence = jaccard(JSON.stringify(a), JSON.stringify(b));
    } else {
      const aLen = args.baseline.body.length;
      const bLen = args.target.body.length;
      const lenDelta = Math.abs(aLen - bLen) / Math.max(aLen, bLen, 1);
      divergence = lenDelta === 0 && aLen > 0 ? 0 : Math.min(1, lenDelta);
    }

    return {
      ok: true,
      value: {
        divergence,
        vulnerable: divergence > 0.2 && args.baseline.status === args.target.status,
        baselineBytes: jsonBytes(baseJson) || args.baseline.body.length,
        targetBytes: jsonBytes(targetJson) || args.target.body.length,
      },
      durationMs: Date.now() - start,
    };
  },
};

function tryParseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const checkWaf: PrimitiveDefinition<
  { response: PrimitiveResponse },
  { detected: boolean; vendor: WafVendor; confidence: number }
> = {
  name: 'checkWaf',
  description: 'Inspect response headers + status for WAF fingerprints. Returns the detected vendor and a 0-1 confidence score.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<{ detected: boolean; vendor: WafVendor; confidence: number }> {
    const start = Date.now();
    const headers = args.response.headers;
    const allHeaderText = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const body = args.response.body.slice(0, 4000);

    let best: { vendor: WafVendor; matches: number } = { vendor: 'unknown', matches: 0 };
    for (const sig of WAF_SIGNATURES) {
      let matches = 0;
      for (const pat of sig.patterns) {
        if (pat.test(allHeaderText) || pat.test(body)) matches++;
      }
      if (matches > best.matches) {
        best = { vendor: sig.vendor, matches };
      }
    }

    return {
      ok: true,
      value: {
        detected: best.matches > 0,
        vendor: best.vendor,
        confidence: Math.min(1, best.matches * 0.4),
      },
      durationMs: Date.now() - start,
    };
  },
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`()]+/g;
const PATH_HREF_PATTERN = /href=["']([^"']+)["']/g;
const ACTION_PATTERN = /<form[^>]+action=["']([^"']+)["']/g;

export const findEndpointsInResponse: PrimitiveDefinition<
  { html: string; baseUrl: string },
  string[]
> = {
  name: 'findEndpointsInResponse',
  description: 'Extract URLs, href targets, and form actions from an HTML response. Used by the spider and the second-order composer.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<string[]> {
    const start = Date.now();
    const found = new Set<string>();
    for (const m of args.html.matchAll(URL_PATTERN)) {
      try {
        const u = new URL(m[0], args.baseUrl);
        if (u.origin === new URL(args.baseUrl).origin) found.add(u.toString());
      } catch {
        // ignore malformed
      }
    }
    for (const m of args.html.matchAll(PATH_HREF_PATTERN)) {
      try {
        const u = new URL(m[1], args.baseUrl);
        if (u.origin === new URL(args.baseUrl).origin) found.add(u.toString());
      } catch {
        // ignore
      }
    }
    for (const m of args.html.matchAll(ACTION_PATTERN)) {
      try {
        const u = new URL(m[1], args.baseUrl);
        if (u.origin === new URL(args.baseUrl).origin) found.add(u.toString());
      } catch {
        // ignore
      }
    }
    return {
      ok: true,
      value: Array.from(found),
      durationMs: Date.now() - start,
    };
  },
};

const SET_COOKIE_PATTERN = /set-cookie:\s*([^=;]+)=([^;]+)/gi;

export const extractSessionCookie: PrimitiveDefinition<
  { response: PrimitiveResponse },
  { cookies: Record<string, string> }
> = {
  name: 'extractSessionCookie',
  description: 'Parse Set-Cookie headers and return a {name: value} map.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<{ cookies: Record<string, string> }> {
    const start = Date.now();
    const cookies: Record<string, string> = {};
    for (const [k, v] of Object.entries(args.response.headers)) {
      if (k.toLowerCase() !== 'set-cookie') continue;
      const m = v.match(/^([^=]+)=([^;]*)/);
      if (m) cookies[m[1].trim()] = m[2].trim();
    }
    // Also try the combined header value
    for (const [k, v] of Object.entries(args.response.headers)) {
      if (k.toLowerCase() === 'set-cookie') {
        const matches = v.matchAll(SET_COOKIE_PATTERN);
        for (const m of matches) {
          cookies[m[1]] = m[2];
        }
      }
    }
    return {
      ok: true,
      value: { cookies },
      durationMs: Date.now() - start,
    };
  },
};

const CSRF_INPUT_PATTERN = /<input[^>]+name=["']([^"']*(?:csrf|token|xsrf|authenticity)[^"']*)["'][^>]*value=["']([^"']*)["']/gi;

export const extractCsrfToken: PrimitiveDefinition<
  { html: string },
  { tokenName: string | null; tokenValue: string | null; allCandidates: Array<{ name: string; value: string }> }
> = {
  name: 'extractCsrfToken',
  description: 'Scan HTML for CSRF token inputs in forms. Returns the most likely token + a list of all candidates.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<{
    tokenName: string | null;
    tokenValue: string | null;
    allCandidates: Array<{ name: string; value: string }>;
  }> {
    const start = Date.now();
    const candidates: Array<{ name: string; value: string }> = [];
    for (const m of args.html.matchAll(CSRF_INPUT_PATTERN)) {
      candidates.push({ name: m[1], value: m[2] });
    }
    const first = candidates[0] ?? null;
    return {
      ok: true,
      value: {
        tokenName: first?.name ?? null,
        tokenValue: first?.value ?? null,
        allCandidates: candidates,
      },
      durationMs: Date.now() - start,
    };
  },
};

// Re-export httpRequest so observation.ts is a self-contained module
export { httpRequest };
// Suppress unused-import warning while keeping the symbol available
void httpRequest;
