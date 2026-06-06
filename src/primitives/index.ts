// src/primitives/index.ts
//
// Primitive registry: a single exportable catalog of all 18+ primitives.
// The Composer imports from here; the strategist references the catalog
// when proposing plans; tests can use it to enumerate the primitive set.

import type { PrimitiveDefinition, PrimitiveName } from './types';
import { httpRequest, multipartUpload, followRedirects } from './http';
import {
  craftPayload,
  craftBypass,
  craftXmlEntity,
  craftMultipart,
} from './payload';
import { injectInContext, omitHeader } from './injection';
import {
  parseResponse,
  evaluateRendered,
  measureTiming,
  compareResponses,
  checkWaf,
  findEndpointsInResponse,
  extractSessionCookie,
  extractCsrfToken,
} from './observation';
import { useSession } from './session';
import { spawnSubtask, recordEvidence, writeFinding, recordTestStep } from './control';

export const PRIMITIVE_CATALOG: Record<PrimitiveName, PrimitiveDefinition<any, any>> = {
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
};

export const PRIMITIVE_LIST: PrimitiveName[] = Object.keys(PRIMITIVE_CATALOG) as PrimitiveName[];

export function getPrimitive(name: PrimitiveName): PrimitiveDefinition<any, any> | undefined {
  return PRIMITIVE_CATALOG[name];
}

export function listBrowserPrimitives(): PrimitiveName[] {
  return PRIMITIVE_LIST.filter((n) => PRIMITIVE_CATALOG[n].requiresBrowser);
}

export function listDeterministicPrimitives(): PrimitiveName[] {
  return PRIMITIVE_LIST.filter((n) => PRIMITIVE_CATALOG[n].deterministic);
}

export function listNonDeterministicPrimitives(): PrimitiveName[] {
  return PRIMITIVE_LIST.filter((n) => !PRIMITIVE_CATALOG[n].deterministic);
}

export {
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
};

export * from './types';
export type { SessionSpec } from './session';
export type { SubtaskRequest, SubtaskHandle, TestStepArgs, TestStepHandle } from './control';
