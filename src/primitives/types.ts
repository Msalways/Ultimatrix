// src/primitives/types.ts
//
// Shared types for the primitive catalog. Every primitive returns a
// `PrimitiveResult` so the Composer can uniformly observe outcomes and
// chain primitive invocations together.

import type { FindingEvidence } from '../core/app-model';
import type { LiveTestWriter } from '../codegen/live-writer';
import type { CrawlerFn } from './spider';

export type PrimitiveName =
  | 'httpRequest'
  | 'multipartUpload'
  | 'followRedirects'
  | 'craftPayload'
  | 'craftBypass'
  | 'craftXmlEntity'
  | 'craftMultipart'
  | 'injectInContext'
  | 'omitHeader'
  | 'parseResponse'
  | 'evaluateRendered'
  | 'measureTiming'
  | 'compareResponses'
  | 'checkWaf'
  | 'findEndpointsInResponse'
  | 'extractSessionCookie'
  | 'extractCsrfToken'
  | 'useSession'
  | 'spawnSubtask'
  | 'recordEvidence'
  | 'writeFinding'
  | 'recordTestStep'
  | 'spiderCrawl';

export type InjectionLocation =
  | 'query'
  | 'body'
  | 'header'
  | 'cookie'
  | 'path'
  | 'filename'
  | 'xml-entity';

export type PayloadType =
  | 'sqli'
  | 'xss'
  | 'ssti'
  | 'path'
  | 'cmd'
  | 'xxe'
  | 'ssrf'
  | 'csrf'
  | 'redirect';

export type WafVendor =
  | 'cloudflare'
  | 'akamai'
  | 'aws-waf'
  | 'imperva'
  | 'modsecurity'
  | 'fastly'
  | 'barracuda'
  | 'f5-bigip'
  | 'sucuri'
  | 'wordfence'
  | 'unknown';

export interface PrimitiveRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  cookies?: Record<string, string>;
  timeoutMs?: number;
}

export interface PrimitiveResponse {
  status: number;
  url: string;
  finalUrl?: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  redirects: string[];
  timing: { dns: number; connect: number; tls: number; ttfb: number; download: number };
}

export interface PrimitiveContext {
  /** Current session role (guest/user/admin) */
  sessionRole?: string;
  /** Cookies for the active session */
  cookies: Record<string, string>;
  /** Base URL for the target */
  baseUrl: string;
  /** Shared evidence log — primitives can append, never overwrite */
  evidenceLog: FindingEvidence[];
  /** Composition depth (0 = top-level, >0 = spawned sub-composer) */
  depth: number;
  /** Per-run budget tracker (ms) */
  budget: { startedAt: number; maxMs: number };
  /** Optional sink for tracking sub-composer spawns (read by Composer.run) */
  subtaskSink?: Array<{ specialist: string; result: 'done' | 'failed'; findings: number }>;
  /**
   * Optional live Playwright-spec writer. When set, the `recordTestStep`
   * primitive appends LLM-chosen steps to it. When unset (e.g. v2 hunt
   * path), recordTestStep returns ok: false with a "no live spec" error
   * and the LLM learns to skip it.
   */
  liveSpec?: LiveTestWriter | null;
  /**
   * Optional crawler injection point for the `spiderCrawl` primitive.
   * When set, the primitive uses this function instead of building a
   * real Playwright SpiderCrawler — useful for tests, mocks, and
   * production flows that want to control the crawl step-by-step
   * (e.g. hand the LLM a per-endpoint mini-crawl).
   */
  crawler?: CrawlerFn;
}

export type PrimitiveResult<T = unknown> = {
  ok: boolean;
  value?: T;
  error?: string;
  /** Duration in ms */
  durationMs: number;
  /** Evidence collected by this primitive (appended to context) */
  evidence?: FindingEvidence[];
  /** Optional: signal that a sub-composer should be spawned */
  spawn?: {
    specialist: 'waf-bypass' | 'second-order' | 'chain-reasoning';
    reason: string;
    payload?: unknown;
  };
};

export interface PrimitiveDefinition<TArgs = unknown, TReturn = unknown> {
  name: PrimitiveName;
  description: string;
  /** Whether the primitive requires a live browser (Playwright) */
  requiresBrowser: boolean;
  /** Whether the primitive is deterministic (no LLM needed) */
  deterministic: boolean;
  execute: (args: TArgs, ctx: PrimitiveContext) => Promise<PrimitiveResult<TReturn>> | PrimitiveResult<TReturn>;
}
