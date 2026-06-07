// src/agents/primitive-helpers.ts
//
// Plain-function wrappers around the 21 primitive definitions. The agent
// loop calls these to execute tool calls from the LLM. We can't use the
// primitives directly because they are wrapped in `PrimitiveDefinition`
// objects; this module exposes the inner logic as functions for easy use.
//
// IMPORTANT: The LLM tool schema (src/agents/tool-schema.ts) wraps a
// request/response inside the args as `{request: {...}}` or
// `{response: {...}}`. The primitives themselves expect the flat object.
// `unwrapArgs` bridges that gap so the LLM follows the schema and the
// primitive gets the shape it needs.

import type {
  PrimitiveContext,
  PrimitiveName,
  PrimitiveRequest,
  PrimitiveResponse,
  PrimitiveResult,
} from '../primitives/types';
import type { AppModelFinding, FindingEvidence } from '../core/app-model';
import {
  httpRequest,
  multipartUpload,
  followRedirects,
  craftPayload,
  craftBypass,
  craftXmlEntity,
  craftMultipart,
  injectInContext,
  omitHeader,
  parseResponse,
  evaluateRendered,
  measureTiming,
  compareResponses,
  checkWaf,
  findEndpointsInResponse,
  extractSessionCookie,
  extractCsrfToken,
  useSession,
  spawnSubtask,
  recordEvidence,
  writeFinding,
  recordTestStep,
  spiderCrawl,
} from '../primitives';
import type { TestStepArgs, TestStepHandle } from '../primitives/control';
import type { SpiderCrawlArgs, SpiderCrawlPrimitiveResult } from '../primitives/spider';

/**
 * Unwrap the LLM's tool-call args to match what the primitive expects.
 *
 * The tool schema in src/agents/tool-schema.ts nests complex objects
 * (request, response, baseline/target) under a named key. The primitive
 * definitions in src/primitives/* expect the flat object. This helper
 * does the unwrap for the primitives that have wrappers. If the LLM
 * already passed a flat object (older format), the helper returns it
 * unchanged — so both shapes work.
 */
function unwrapArgs(name: PrimitiveName, raw: unknown): any {
  if (!raw || typeof raw !== 'object') return raw;
  const o = raw as Record<string, unknown>;
  switch (name) {
    case 'httpRequest':
      // Schema: { request: {...} }. Primitive: PrimitiveRequest.
      // Accept both wrapped and flat.
      if (o.request && typeof o.request === 'object') return o.request;
      return o;
    case 'followRedirects':
      // Schema: { initial: {...}, maxHops? }
      if (o.initial && typeof o.initial === 'object') {
        return { initial: o.initial, maxHops: o.maxHops };
      }
      return o;
    case 'injectInContext':
      // Schema: { payload, location, base, paramName? }
      // Primitive: same shape. No unwrap needed.
      return o;
    case 'parseResponse':
      // Schema: { response: {...} }. Primitive: takes PrimitiveResponse directly.
      // (parseResponse is the one primitive that doesn't wrap its arg.)
      if (o.response && typeof o.response === 'object') return o.response;
      return o;
    case 'checkWaf':
      // Schema: { response: {...} }. Primitive: { response }.
      if (o.response && typeof o.response === 'object') return { response: o.response };
      return o;
    case 'compareResponses':
      // Schema: { baseline, target, ignoreKeys? }
      if (o.baseline && o.target) return o;
      return o;
    case 'extractSessionCookie':
      // Schema: { response: {...} }. Primitive: { response }.
      if (o.response && typeof o.response === 'object') return { response: o.response };
      return o;
    default:
      return o;
  }
}

/**
 * Execute a primitive by name with the given args. Returns the PrimitiveResult.
 *
 * Block 21: `onPrimitive` is an optional callback fired AFTER each
 * primitive call completes. It's used by the agent loop to surface
 * per-primitive timing/result to the v4 event stream / web UI / TUI.
 * Passing it here means the agent loop doesn't have to wrap the call
 * in its own timer — the helper owns the timing and the callback fires
 * even on error paths.
 */
export async function executePrimitive(
  name: PrimitiveName,
  args: unknown,
  ctx: PrimitiveContext,
  onPrimitive?: (name: PrimitiveName, args: unknown, result: PrimitiveResult) => void,
): Promise<PrimitiveResult> {
  const a = unwrapArgs(name, args);
  const t0 = Date.now();
  let result: PrimitiveResult;
  try {
    switch (name) {
    case 'httpRequest':
      result = await httpRequest.execute(a as PrimitiveRequest, ctx);
      break;
    case 'multipartUpload':
      result = await multipartUpload.execute(
        a as { url: string; filename: string; contentType: string; content: Buffer | string; headers?: Record<string, string> },
        ctx,
      );
      break;
    case 'followRedirects':
      result = await followRedirects.execute(
        a as { initial: PrimitiveResponse; maxHops?: number },
        ctx,
      );
      break;
    case 'craftPayload':
      result = await craftPayload.execute(a as never, ctx);
      break;
    case 'craftBypass':
      result = await craftBypass.execute(a as never, ctx);
      break;
    case 'craftXmlEntity':
      result = await craftXmlEntity.execute(a as never, ctx);
      break;
    case 'craftMultipart':
      result = await craftMultipart.execute(a as never, ctx);
      break;
    case 'injectInContext':
      result = await injectInContext.execute(a as never, ctx);
      break;
    case 'omitHeader':
      result = await omitHeader.execute(a as { headers: Record<string, string>; name: string }, ctx);
      break;
    case 'parseResponse':
      result = await parseResponse.execute(a as never, ctx);
      break;
    case 'evaluateRendered':
      result = await evaluateRendered.execute(a as never, ctx);
      break;
    case 'measureTiming':
      result = await measureTiming.execute(a as never, ctx);
      break;
    case 'compareResponses':
      result = await compareResponses.execute(
        a as { baseline: PrimitiveResponse; target: PrimitiveResponse; ignoreKeys?: string[] },
        ctx,
      );
      break;
    case 'checkWaf':
      result = await checkWaf.execute(a as { response: PrimitiveResponse }, ctx);
      break;
    case 'findEndpointsInResponse':
      result = await findEndpointsInResponse.execute(
        a as { html: string; baseUrl: string },
        ctx,
      );
      break;
    case 'extractSessionCookie':
      result = await extractSessionCookie.execute(a as { response: PrimitiveResponse }, ctx);
      break;
    case 'extractCsrfToken':
      result = await extractCsrfToken.execute(a as { html: string }, ctx);
      break;
    case 'useSession':
      result = await useSession.execute(
        a as { role: string; cookies?: Record<string, string>; bearerToken?: string },
        ctx,
      );
      break;
    case 'spawnSubtask':
      result = await spawnSubtask.execute(a as never, ctx);
      break;
    case 'recordEvidence':
      result = await recordEvidence.execute(a as FindingEvidence, ctx);
      break;
    case 'writeFinding':
      result = await writeFinding.execute(
        a as {
          type: string;
          endpoint: string;
          param: string;
          method?: string;
          payload?: string;
          description?: string;
          severity: string;
          confidence: number;
        },
        ctx,
      );
      break;
    case 'recordTestStep':
      result = await recordTestStep.execute(a as TestStepArgs, ctx) as PrimitiveResult<TestStepHandle>;
      break;
    case 'spiderCrawl':
      result = await spiderCrawl.execute(a as SpiderCrawlArgs, ctx) as PrimitiveResult<SpiderCrawlPrimitiveResult>;
      break;
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown primitive: ${exhaustive as string}`);
    }
    }
  } catch (e) {
    result = { ok: false, error: (e as Error).message, durationMs: Date.now() - t0 };
    if (onPrimitive) {
      try { onPrimitive(name, args, result); } catch { /* best effort */ }
    }
    return result;
  }
  // Stamp duration if the primitive didn't set one.
  if (typeof result.durationMs !== 'number') {
    result.durationMs = Date.now() - t0;
  }
  if (onPrimitive) {
    try { onPrimitive(name, args, result); } catch { /* best effort */ }
  }
  return result;
}

/**
 * Convenience: record evidence directly (used by the finding helper).
 */
export function recordEvidencePrimitive(
  evidence: FindingEvidence,
  ctx: PrimitiveContext,
): PrimitiveResult<void> | Promise<PrimitiveResult<void>> {
  return recordEvidence.execute(evidence, ctx);
}

/**
 * Convenience: write a finding directly (used by the finding helper after triage).
 */
export function writeFindingPrimitive(
  args: {
    type: string;
    endpoint: string;
    param: string;
    method?: string;
    payload?: string;
    description?: string;
    severity: string;
    confidence: number;
  },
  ctx: PrimitiveContext,
): PrimitiveResult<AppModelFinding> | Promise<PrimitiveResult<AppModelFinding>> {
  return writeFinding.execute(args, ctx);
}

/**
 * Get the description of a primitive (for prompts / debug).
 */
export function describePrimitive(name: PrimitiveName): string {
  const defs: Record<PrimitiveName, { description: string }> = {
    httpRequest,
    multipartUpload,
    followRedirects,
    craftPayload,
    craftBypass,
    craftXmlEntity,
    craftMultipart,
    injectInContext,
    omitHeader,
    parseResponse,
    evaluateRendered,
    measureTiming,
    compareResponses,
    checkWaf,
    findEndpointsInResponse,
    extractSessionCookie,
    extractCsrfToken,
    useSession,
    spawnSubtask,
    recordEvidence,
    writeFinding,
    recordTestStep,
    spiderCrawl,
  };
  return defs[name].description;
}
