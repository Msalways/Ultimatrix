import type { PrimitiveContext, PrimitiveName, PrimitiveRequest, PrimitiveResponse, PrimitiveResult } from '../primitives/types';
import type { FindingEvidence } from '../core/app-model';
import { getGlobalRegistry } from '../plugins/registry';
import { registerBuiltins } from '../primitives';

let primitivesInited = false;
function ensurePrimitives(): void {
  if (primitivesInited) return;
  primitivesInited = true;
  const r = getGlobalRegistry();
  if (r.listPrimitives().length === 0) {
    registerBuiltins();
  }
}

function unwrapArgs(name: PrimitiveName, raw: unknown): any {
  if (!raw || typeof raw !== 'object') return raw;
  const o = raw as Record<string, unknown>;
  switch (name) {
    case 'httpRequest':
      if (o.request && typeof o.request === 'object') return o.request;
      return o;
    case 'followRedirects':
      if (o.initial && typeof o.initial === 'object') {
        return { initial: o.initial, maxHops: o.maxHops };
      }
      return o;
    case 'injectInContext':
      return o;
    case 'parseResponse':
      if (o.response && typeof o.response === 'object') return o.response;
      return o;
    case 'checkWaf':
      if (o.response && typeof o.response === 'object') return { response: o.response };
      return o;
    case 'compareResponses':
      if (o.baseline && o.target) return o;
      return o;
    case 'extractSessionCookie':
      if (o.response && typeof o.response === 'object') return { response: o.response };
      return o;
    default:
      return o;
  }
}

export async function executePrimitive(
  name: PrimitiveName,
  args: unknown,
  ctx: PrimitiveContext,
  onPrimitive?: (name: PrimitiveName, args: unknown, result: PrimitiveResult) => void,
): Promise<PrimitiveResult> {
  ensurePrimitives();
  const a = unwrapArgs(name, args);
  const result = await getGlobalRegistry().executePrimitive(name, a, ctx);
  if (onPrimitive) {
    try { onPrimitive(name, args, result); } catch { /* best effort */ }
  }
  return result;
}

export function recordEvidencePrimitive(
  evidence: FindingEvidence,
  ctx: PrimitiveContext,
): PrimitiveResult<void> | Promise<PrimitiveResult<void>> {
  ensurePrimitives();
  const prim = getGlobalRegistry().getPrimitive('recordEvidence');
  if (!prim) return { ok: false, error: 'recordEvidence not registered', durationMs: 0 };
  return prim.execute(evidence, ctx) as Promise<PrimitiveResult<void>>;
}

export function writeFindingPrimitive(
  args: {
    type: string; endpoint: string; param: string; method?: string; payload?: string;
    description?: string; severity: string; confidence: number;
  },
  ctx: PrimitiveContext,
): PrimitiveResult<import('../core/app-model').AppModelFinding> | Promise<PrimitiveResult<import('../core/app-model').AppModelFinding>> {
  ensurePrimitives();
  const prim = getGlobalRegistry().getPrimitive('writeFinding');
  if (!prim) return { ok: false, error: 'writeFinding not registered', durationMs: 0 };
  return prim.execute(args, ctx) as Promise<PrimitiveResult<import('../core/app-model').AppModelFinding>>;
}

export function describePrimitive(name: PrimitiveName): string {
  ensurePrimitives();
  const prim = getGlobalRegistry().getPrimitive(name);
  return prim?.description ?? 'unknown primitive';
}
