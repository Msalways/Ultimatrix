// src/oast/primitives.ts
//
// Pure functions for the 5 OOB primitives. Each takes a payload template
// and the OastServer + HuntCore, and returns the probe outcome. The agent
// loop calls these from specialist runners.

import { withOobCallback, type WithOobOptions, type WithOobResult } from './wrapper';
import { OOB_TEMPLATES } from './categories';
import type { OOBCategory } from './categories';
import type { OastServer } from './server';
import type { HuntCore } from '../hunt/core';

export type OOBPrimitive = (opts: Omit<WithOobOptions, 'category'>) => Promise<WithOobResult>;

export function makeOOBPrimitive(category: OOBCategory): OOBPrimitive {
  return (opts) => withOobCallback({ ...opts, category });
}

export const ssrfPrimitive: OOBPrimitive = (opts) =>
  withOobCallback({ ...opts, category: 'ssrf', payloadTemplate: OOB_TEMPLATES.ssrf[0] });

export const blindXssPrimitive: OOBPrimitive = (opts) =>
  withOobCallback({ ...opts, category: 'blind-xss', payloadTemplate: OOB_TEMPLATES['blind-xss'][0] });

export const blindSqliPrimitive: OOBPrimitive = (opts) =>
  withOobCallback({ ...opts, category: 'blind-sqli', payloadTemplate: OOB_TEMPLATES['blind-sqli'][0] });

export const xxePrimitive: OOBPrimitive = (opts) =>
  withOobCallback({ ...opts, category: 'xxe', payloadTemplate: OOB_TEMPLATES.xxe[0] });

export const deserializationPrimitive: OOBPrimitive = (opts) =>
  withOobCallback({ ...opts, category: 'deserialization', payloadTemplate: OOB_TEMPLATES.deserialization[0] });

/** All 5 OOB primitives. */
export const OOB_PRIMITIVES: Record<OOBCategory, OOBPrimitive> = {
  'ssrf': ssrfPrimitive,
  'blind-xss': blindXssPrimitive,
  'blind-sqli': blindSqliPrimitive,
  'xxe': xxePrimitive,
  'deserialization': deserializationPrimitive,
};
