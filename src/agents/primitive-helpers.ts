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
 */
export async function executePrimitive(
  name: PrimitiveName,
  args: unknown,
  ctx: PrimitiveContext,
): Promise<PrimitiveResult> {
  const a = unwrapArgs(name, args);
  switch (name) {
    case 'httpRequest':
      return httpRequest.execute(a as PrimitiveRequest, ctx);
    case 'multipartUpload':
      return multipartUpload.execute(
        a as { url: string; filename: string; contentType: string; content: Buffer | string; headers?: Record<string, string> },
        ctx,
      );
    case 'followRedirects':
      return followRedirects.execute(
        a as { initial: PrimitiveResponse; maxHops?: number },
        ctx,
      );
    case 'craftPayload':
      return craftPayload.execute(a as never, ctx);
    case 'craftBypass':
      return craftBypass.execute(a as never, ctx);
    case 'craftXmlEntity':
      return craftXmlEntity.execute(a as never, ctx);
    case 'craftMultipart':
      return craftMultipart.execute(a as never, ctx);
    case 'injectInContext':
      return injectInContext.execute(a as never, ctx);
    case 'omitHeader':
      return omitHeader.execute(a as { headers: Record<string, string>; name: string }, ctx);
    case 'parseResponse':
      return parseResponse.execute(a as never, ctx);
    case 'evaluateRendered':
      return evaluateRendered.execute(a as never, ctx);
    case 'measureTiming':
      return measureTiming.execute(a as never, ctx);
    case 'compareResponses':
      return compareResponses.execute(
        a as { baseline: PrimitiveResponse; target: PrimitiveResponse; ignoreKeys?: string[] },
        ctx,
      );
    case 'checkWaf':
      return checkWaf.execute(a as { response: PrimitiveResponse }, ctx);
    case 'findEndpointsInResponse':
      return findEndpointsInResponse.execute(
        a as { html: string; baseUrl: string },
        ctx,
      );
    case 'extractSessionCookie':
      return extractSessionCookie.execute(a as { response: PrimitiveResponse }, ctx);
    case 'extractCsrfToken':
      return extractCsrfToken.execute(a as { html: string }, ctx);
    case 'useSession':
      return useSession.execute(
        a as { role: string; cookies?: Record<string, string>; bearerToken?: string },
        ctx,
      );
    case 'spawnSubtask':
      return spawnSubtask.execute(a as never, ctx);
    case 'recordEvidence':
      return recordEvidence.execute(a as FindingEvidence, ctx);
    case 'writeFinding':
      return writeFinding.execute(
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
    case 'recordTestStep':
      return recordTestStep.execute(a as TestStepArgs, ctx) as PrimitiveResult<TestStepHandle>;
    case 'spiderCrawl':
      return spiderCrawl.execute(a as SpiderCrawlArgs, ctx) as PrimitiveResult<SpiderCrawlPrimitiveResult>;
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown primitive: ${exhaustive as string}`);
    }
  }
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
