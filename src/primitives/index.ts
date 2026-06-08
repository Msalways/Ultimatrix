import type { PrimitiveDefinition, PrimitiveName } from './types';
import { httpRequest, multipartUpload, followRedirects } from './http';
import { craftPayload, craftBypass, craftXmlEntity, craftMultipart } from './payload';
import { injectInContext, omitHeader } from './injection';
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse, extractSessionCookie, extractCsrfToken } from './observation';
import { useSession } from './session';
import { spawnSubtask, recordEvidence, writeFinding, recordTestStep } from './control';
import { spiderCrawl } from './spider';
import { getGlobalRegistry } from '../plugins/registry';

const BUILTIN_PRIMITIVES: Record<string, PrimitiveDefinition<any, any>> = {
  httpRequest, multipartUpload, followRedirects,
  craftPayload, craftBypass, craftXmlEntity, craftMultipart,
  injectInContext, omitHeader,
  parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf,
  findEndpointsInResponse, extractSessionCookie, extractCsrfToken,
  useSession,
  spawnSubtask, recordEvidence, writeFinding, recordTestStep,
  spiderCrawl,
};

export const PRIMITIVE_LIST: PrimitiveName[] = Object.keys(BUILTIN_PRIMITIVES) as PrimitiveName[];

export function registerBuiltins(): void {
  getGlobalRegistry().registerPlugin({
    name: 'builtin',
    version: '2.0.0',
    description: 'Built-in Ultimatrix primitives (HTTP, injection, observation, control, spider)',
    primitives: BUILTIN_PRIMITIVES,
  });
}

export function getPrimitive(name: PrimitiveName): PrimitiveDefinition<any, any> | undefined {
  return getGlobalRegistry().getPrimitive(name) as PrimitiveDefinition<any, any> | undefined;
}

export function listBrowserPrimitives(): PrimitiveName[] {
  return PRIMITIVE_LIST.filter((n) => {
    const p = getGlobalRegistry().getPrimitive(n);
    return p ? p.requiresBrowser : false;
  });
}

export function listDeterministicPrimitives(): PrimitiveName[] {
  return PRIMITIVE_LIST.filter((n) => {
    const p = getGlobalRegistry().getPrimitive(n);
    return p ? p.deterministic : false;
  });
}

export function listNonDeterministicPrimitives(): PrimitiveName[] {
  return PRIMITIVE_LIST.filter((n) => {
    const p = getGlobalRegistry().getPrimitive(n);
    return p ? !p.deterministic : false;
  });
}

export {
  httpRequest, multipartUpload, followRedirects,
  craftPayload, craftBypass, craftXmlEntity, craftMultipart,
  injectInContext, omitHeader,
  parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf,
  findEndpointsInResponse, extractSessionCookie, extractCsrfToken,
  useSession,
  spawnSubtask, recordEvidence, writeFinding, recordTestStep,
  spiderCrawl,
};

export * from './types';
export type { SessionSpec } from './session';
export type { SubtaskRequest, SubtaskHandle, TestStepArgs, TestStepHandle } from './control';
export type { SpiderCrawlArgs, SpiderCrawlPrimitiveResult, SpiderCrawlRoute, CrawlerFn } from './spider';
