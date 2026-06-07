// src/agents/primitive-helpers.ts
//
// Plain-function wrappers around the 21 primitive definitions. The agent
// loop calls these to execute tool calls from the LLM. We can't use the
// primitives directly because they are wrapped in `PrimitiveDefinition`
// objects; this module exposes the inner logic as functions for easy use.

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
 * Execute a primitive by name with the given args. Returns the PrimitiveResult.
 */
export async function executePrimitive(
  name: PrimitiveName,
  args: unknown,
  ctx: PrimitiveContext,
): Promise<PrimitiveResult> {
  switch (name) {
    case 'httpRequest':
      return httpRequest.execute(args as PrimitiveRequest, ctx);
    case 'multipartUpload':
      return multipartUpload.execute(
        args as { url: string; filename: string; contentType: string; content: Buffer | string; headers?: Record<string, string> },
        ctx,
      );
    case 'followRedirects':
      return followRedirects.execute(
        args as { initial: PrimitiveResponse; maxHops?: number },
        ctx,
      );
    case 'craftPayload':
      return craftPayload.execute(args as never, ctx);
    case 'craftBypass':
      return craftBypass.execute(args as never, ctx);
    case 'craftXmlEntity':
      return craftXmlEntity.execute(args as never, ctx);
    case 'craftMultipart':
      return craftMultipart.execute(args as never, ctx);
    case 'injectInContext':
      return injectInContext.execute(args as never, ctx);
    case 'omitHeader':
      return omitHeader.execute(args as { headers: Record<string, string>; name: string }, ctx);
    case 'parseResponse':
      return parseResponse.execute(args as PrimitiveResponse, ctx);
    case 'evaluateRendered':
      return evaluateRendered.execute(args as never, ctx);
    case 'measureTiming':
      return measureTiming.execute(args as never, ctx);
    case 'compareResponses':
      return compareResponses.execute(
        args as { baseline: PrimitiveResponse; target: PrimitiveResponse; ignoreKeys?: string[] },
        ctx,
      );
    case 'checkWaf':
      return checkWaf.execute(args as { response: PrimitiveResponse }, ctx);
    case 'findEndpointsInResponse':
      return findEndpointsInResponse.execute(
        args as { html: string; baseUrl: string },
        ctx,
      );
    case 'extractSessionCookie':
      return extractSessionCookie.execute(args as { response: PrimitiveResponse }, ctx);
    case 'extractCsrfToken':
      return extractCsrfToken.execute(args as { html: string }, ctx);
    case 'useSession':
      return useSession.execute(
        args as { role: string; cookies?: Record<string, string>; bearerToken?: string },
        ctx,
      );
    case 'spawnSubtask':
      return spawnSubtask.execute(args as never, ctx);
    case 'recordEvidence':
      return recordEvidence.execute(args as FindingEvidence, ctx);
    case 'writeFinding':
      return writeFinding.execute(
        args as {
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
      return recordTestStep.execute(args as TestStepArgs, ctx) as PrimitiveResult<TestStepHandle>;
    case 'spiderCrawl':
      return spiderCrawl.execute(args as SpiderCrawlArgs, ctx) as PrimitiveResult<SpiderCrawlPrimitiveResult>;
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
