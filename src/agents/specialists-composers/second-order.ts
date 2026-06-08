// src/agents/specialists-composers/second-order.ts
//
// Second-order attack specialist composer. Spawned by the main Composer
// when a first-order payload is blocked/sanitized but the response
// contains a value that gets stored and reflected later.
//
// Pattern:
// 1. Submit the payload to endpoint A (e.g. POST /api/profile with
//    bio=<script>alert(1)</script>)
// 2. Follow the storage: GET /api/users/1/profile, render the page
// 3. If the stored value is reflected unescaped in a different page,
//    confirm second-order XSS / SQLi / SSRF

import type { LLMClient } from '../../llm/client';
import type { AppModelEndpoint, AppModelFinding } from '../../core/app-model';
import {
  type PrimitiveContext,
} from '../../primitives';
import { getGlobalRegistry } from '../../plugins/registry';

export interface SecondOrderInput {
  /** The endpoint where the payload was first submitted */
  storageEndpoint: AppModelEndpoint;
  /** The endpoint where the payload is reflected later */
  reflectionEndpoint: AppModelEndpoint;
  /** The first-order payload that was sanitized */
  originalPayload: string;
  /** The technique being tested (xss, sqli, ssti, etc.) */
  technique: string;
  /** The LLM client */
  llm: LLMClient;
  /** Recursion depth */
  depth: number;
  /** Cookies for the active session */
  cookies: Record<string, string>;
  /** Callback for findings */
  onFinding?: (f: AppModelFinding) => void;
}

export interface SecondOrderResult {
  findings: AppModelFinding[];
  reflected: boolean;
  variantsTried: string[];
  durationMs: number;
}

const SYSTEM_PROMPT_SECOND = `You are a second-order attack specialist. The first-order payload was sanitized, but the value may be stored and reflected in a different context. Generate 3 variants that survive sanitization at storage time but execute at reflection time.

Strategies:
- HTML entity encoding that browsers still parse
- Mixed-case tag names
- Encoded JavaScript that decodes at runtime
- SVG/markdown/BBCode injection
- Polyglot payloads

Return JSON: {"variants": ["..."], "reasoning": "..."}`;

export async function runSecondOrder(input: SecondOrderInput): Promise<SecondOrderResult> {
  const start = Date.now();
  const findings: AppModelFinding[] = [];
  const variantsTried: string[] = [];
  let reflected = false;

  // 1. Generate variants
  let variants: string[] = [input.originalPayload]; // Always try the original first
  if (input.llm.isReal()) {
    const r = await input.llm.call({
      system: SYSTEM_PROMPT_SECOND,
      user: `Original payload: ${input.originalPayload}\nTechnique: ${input.technique}\nStorage endpoint: ${input.storageEndpoint.path}\nReflection endpoint: ${input.reflectionEndpoint.path}\n\nGenerate second-order variants.`,
      temperature: 0.4,
    });
    if (r.json && typeof r.json === 'object') {
      const j = r.json as { variants?: unknown };
      if (Array.isArray(j.variants)) {
        variants.push(...j.variants.filter((v): v is string => typeof v === 'string'));
      }
    }
  }

  // 2. For each variant: POST to storage, then GET reflection, check for unescaped rendering
  const ctx: PrimitiveContext = {
    baseUrl: input.reflectionEndpoint.path,
    cookies: input.cookies,
    evidenceLog: [],
    depth: input.depth,
    budget: { startedAt: Date.now(), maxMs: 60_000 },
  };

  const registry = getGlobalRegistry();
  for (const variant of variants.slice(0, 8)) {
    try {
      // POST the variant to the storage endpoint
      const postInjected = await registry.executePrimitive(
        'injectInContext',
        {
          payload: variant,
          location: 'body',
          base: { method: 'POST', url: input.storageEndpoint.path, headers: { 'content-type': 'application/json' }, body: '{}' },
          paramName: input.storageEndpoint.params?.[0] ?? 'data',
        },
        ctx,
      );
      if (!postInjected.ok || !postInjected.value) continue;
      await registry.executePrimitive('httpRequest', postInjected.value, ctx);

      // GET the reflection endpoint
      const getReq = { method: 'GET', url: input.reflectionEndpoint.path, headers: {} };
      const getRes = await registry.executePrimitive('httpRequest', getReq, ctx);
      if (!getRes.ok || !getRes.value) continue;

      const body = (getRes.value as any).body as string;
      variantsTried.push(variant);

      // Check if the variant is reflected unescaped
      const isReflected =
        body.includes(variant) ||
        body.includes(variant.replace(/</g, '&lt;')) === false && body.includes(variant.replace(/</g, ''));

      if (isReflected && (body.toLowerCase().includes('<script') || body.toLowerCase().includes('onerror') || body.toLowerCase().includes('onload'))) {
        reflected = true;
        const paramKey = typeof input.reflectionEndpoint.params?.[0] === 'string'
          ? input.reflectionEndpoint.params[0]
          : (input.reflectionEndpoint.params?.[0] as any)?.name ?? '';
        const finding: AppModelFinding = {
          id: `f-2nd-${Date.now()}`,
          type: `second-order-${input.technique}`,
          endpoint: input.reflectionEndpoint.path,
          param: paramKey,
          method: 'GET',
          payload: variant,
          description: `Second-order ${input.technique}: payload stored at ${input.storageEndpoint.path} is reflected unescaped at ${input.reflectionEndpoint.path}.`,
          severity: 'high',
          confidence: 0.75,
          confirmed: true,
          evidence: [
            { type: 'text', data: `POST ${input.storageEndpoint.path} with payload: ${variant.slice(0, 200)}`, label: 'storage submission', timestamp: Date.now() },
            { type: 'text', data: `GET ${input.reflectionEndpoint.path} reflected: ${body.slice(0, 800)}`, label: 'reflection', timestamp: Date.now() },
          ],
        };
        findings.push(finding);
        input.onFinding?.(finding);
        break;
      }
    } catch {
      // ignore
    }
  }

  return { findings, reflected, variantsTried, durationMs: Date.now() - start };
}
