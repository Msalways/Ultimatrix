// src/agents/specialists-composers/waf-bypass.ts
//
// WAF bypass specialist composer. Spawned by the main Composer when a
// request is blocked by a WAF (Cloudflare, Akamai, AWS WAF, etc.).
// The specialist:
// 1. Asks the LLM to generate WAF-bypass variants of the blocked payload
// 2. Tries each variant via injectInContext + httpRequest
// 3. If the variant succeeds (no 403, no WAF response), confirms bypass
// 4. Records evidence (the request, the response, the variant that worked)
//
// This is a "specialist composer" — it has a restricted primitive subset
// focused on WAF bypass, and can recursively spawn chain-reasoning if
// the bypass reveals a higher-severity finding.

import type { LLMClient } from '../../llm/client';
import type { AppModelEndpoint, AppModelFinding } from '../../core/app-model';
import {
  type PrimitiveContext,
  type PrimitiveName,
  PRIMITIVE_CATALOG,
} from '../../primitives';

export interface WafBypassInput {
  /** The original payload that was blocked */
  payload: string;
  /** The WAF vendor detected (cloudflare, akamai, etc.) */
  wafVendor: string;
  /** The original request that was blocked */
  originalRequest: { method: string; url: string; headers: Record<string, string> };
  /** The original blocked response */
  blockedResponse: { status: number; body: string; headers: Record<string, string> };
  /** The target endpoint (for context) */
  target: AppModelEndpoint;
  /** Recursion depth (should be 1 when called by main composer) */
  depth: number;
  /** The LLM client */
  llm: LLMClient;
  /** Callback for findings */
  onFinding?: (f: AppModelFinding) => void;
}

export interface WafBypassResult {
  findings: AppModelFinding[];
  bypassed: boolean;
  /** The variant that worked, if any */
  workingVariant: string | null;
  /** Variants tried */
  variantsTried: string[];
  /** Total duration */
  durationMs: number;
}

const SYSTEM_PROMPT_BYPASS = `You are a WAF bypass specialist. Given a blocked payload and the detected WAF vendor, generate 3-5 bypass variants. Each variant should be a different mutation strategy:
- Encoding (URL, double-URL, unicode, hex)
- Comment injection (//, /* */, --)
- Case variation
- Null bytes
- HTTP parameter pollution
- WAF-specific quirks (e.g. Cloudflare ignores X-Forwarded-For, Akamai strips comments, etc.)

Return JSON: {"variants": ["variant1", "variant2", ...], "reasoning": "brief explanation of the bypass strategy"}

Respond with ONLY JSON.`;

export async function runWafBypass(input: WafBypassInput): Promise<WafBypassResult> {
  const start = Date.now();
  const findings: AppModelFinding[] = [];
  const variantsTried: string[] = [];
  let workingVariant: string | null = null;

  // 1. Get bypass variants — LLM first, then deterministic fallback
  let variants: string[] = [];
  if (input.llm.isReal()) {
    const r = await input.llm.call({
      system: SYSTEM_PROMPT_BYPASS,
      user: `WAF vendor: ${input.wafVendor}\nBlocked payload: ${input.payload}\nBlocked status: ${input.blockedResponse.status}\nBlocked body (first 500 chars): ${input.blockedResponse.body.slice(0, 500)}\n\nGenerate bypass variants.`,
      temperature: 0.4,
    });
    if (r.json && typeof r.json === 'object') {
      const j = r.json as { variants?: unknown };
      if (Array.isArray(j.variants)) {
        variants = j.variants.filter((v): v is string => typeof v === 'string');
      }
    }
  }

  // Always add deterministic variants (from craftBypass) as a baseline
  const detResult = await Promise.resolve(PRIMITIVE_CATALOG['craftBypass'].execute(
    { payload: input.payload, wafType: input.wafVendor },
    mkCtx(),
  ));
  if (detResult.ok && Array.isArray(detResult.value)) {
    variants = [...variants, ...(detResult.value as string[])];
  }
  // De-dupe
  variants = Array.from(new Set(variants)).slice(0, 12);

  // 2. Try each variant
  const ctx = mkCtx();
  ctx.depth = input.depth;
  for (const variant of variants) {
    try {
      // Build the request with the variant injected
      const injected = await Promise.resolve(PRIMITIVE_CATALOG['injectInContext'].execute(
        {
          payload: variant,
          location: 'query',
          base: {
            method: input.originalRequest.method,
            url: input.originalRequest.url,
            headers: input.originalRequest.headers,
          },
          paramName: input.target.params?.[0],
        },
        ctx,
      ));
      if (!injected.ok || !injected.value) continue;
      const r = PRIMITIVE_CATALOG['httpRequest'].execute(injected.value as any, ctx);
      const result = await Promise.resolve(r);
      variantsTried.push(variant);
      if (result.ok && result.value) {
        const res = result.value as { status: number; body: string };
        // Bypass succeeded if: 200 (not blocked), or a different error than the WAF response
        const isBlocked = res.status === 403 || /waf|blocked|denied|firewall/i.test(res.body);
        if (!isBlocked && res.status < 500) {
          workingVariant = variant;
          // Record evidence
          const finding: AppModelFinding = {
            id: `f-waf-${Date.now()}`,
            type: `${input.target.method.toLowerCase()}-waf-bypass`,
            endpoint: input.target.path,
            param: typeof input.target.params?.[0] === 'string' ? input.target.params[0] : ((input.target.params?.[0] as any)?.name ?? ''),
            method: input.target.method,
            payload: variant,
            description: `WAF bypass confirmed against ${input.wafVendor}. Variant: ${variant.slice(0, 100)}`,
            severity: 'high',
            confidence: 0.85,
            confirmed: true,
            evidence: [
              {
                type: 'raw_request',
                data: JSON.stringify({ method: input.originalRequest.method, url: input.originalRequest.url, body: variant }).slice(0, 1000),
                label: 'bypass request',
                timestamp: Date.now(),
              },
              {
                type: 'raw_response',
                data: res.body.slice(0, 1500),
                label: 'bypass response',
                timestamp: Date.now(),
              },
            ],
          };
          findings.push(finding);
          input.onFinding?.(finding);
          break;
        }
      }
    } catch {
      // ignore variant errors, try the next
    }
  }

  return {
    findings,
    bypassed: workingVariant !== null,
    workingVariant,
    variantsTried,
    durationMs: Date.now() - start,
  };
}

function mkCtx(): PrimitiveContext {
  return {
    baseUrl: '',
    cookies: {},
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: Date.now(), maxMs: 60_000 },
  };
}
