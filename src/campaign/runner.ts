/**
 * Campaign Primitive Runner — Phase 2 / T2.6
 *
 * Builds a `PrimitiveRunner` callback (the type the campaign executor invokes
 * per primitive × slice). The runner:
 *   1. resolves the primitive by id
 *   2. builds a TechniqueContext from the slice (endpoint/param/role/state)
 *   3. runs the primitive end-to-end via the real HTTP tool (`httpRequest`)
 *   4. records tool output into the supplied EvidenceGate (anti-hallucination)
 *   5. maps the framework `PrimitiveResult` → campaign `PrimitiveResult`
 *
 * Confirmed results are persisted by the executor (executor.ts → writeFinding),
 * which consults the same EvidenceGate via setEvidenceGateForFindings().
 */

import {
  getPrimitive,
  runPrimitive,
  type AttackStep,
  type StepExecutionResult,
  type TechniqueContext,
} from '../primitives/framework'
import { httpRequest } from '../tools/http-tools'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import type { GraphStore } from '../graph/store'
import type { UltimatrixConfig } from '../config'
import type {PrimitiveRunner} from './types'

/**
 * Step executor: performs a primitive's AttackStep as a real HTTP request
 * using the existing `httpRequest` tool, returning status/headers/body.
 */
async function httpExecutor(step: AttackStep): Promise<StepExecutionResult> {
  try {
    const r: any = await (httpRequest as any).execute({
      method: step.request.method,
      url: step.request.url,
      headers: step.request.headers,
      body: step.request.body,
    })
    if (!r?.ok) {
      return {
        step,
        ok: false,
        error: r?.error ?? 'http request failed',
      }
    }
    return {
      step,
      ok: true,
      status: r.value?.status,
      headers: r.value?.headers,
      body: r.value?.body,
      durationMs: r.value?.durationMs,
    }
  } catch (e: any) {
    return { step, ok: false, error: e?.message ?? String(e) }
  }
}

/**
 * Create a PrimitiveRunner bound to a graph store, config, and EvidenceGate.
 * The gate is shared with `writeFinding` (set via setEvidenceGateForFindings)
 * so the maker/checker downgrade applies to campaign-persisted findings.
 */
export function createPrimitiveRunner(
  graphStore: GraphStore,
  _config: UltimatrixConfig,
  gate: EvidenceGate,
): PrimitiveRunner {
  return async (primitiveId, slice, _ctx) => {
    const primitive = getPrimitive(primitiveId)
    if (!primitive) {
      return {
        primitiveId,
        confirmed: false,
        confidence: 0,
        description: `unknown primitive "${primitiveId}"`,
      }
    }

    const target = slice.endpoint.url
    // Pull the analyser-assigned typed semantics (useCase / authType / tags) so
    // primitive routing keys off a single source of truth instead of re-deriving
    // endpoint purpose from URL names.
    const epNode = graphStore.getNode(slice.endpoint.id)
    const epProps = epNode && 'properties' in epNode ? (epNode as any).properties : undefined
    const techniqueCtx: TechniqueContext = {
      target,
      endpoint: {
        url: target,
        method: slice.endpoint.method,
        authRequired: epProps?.authRequired,
        authType: epProps?.authType,
        useCase: epProps?.useCase,
        tags: epProps?.tags,
      },
      param: slice.params[0],
      role: slice.role,
      state: slice.state ? (slice.state as unknown as Record<string, unknown>) : undefined,
    }

    if (!primitive.appliesTo(techniqueCtx)) {
      return {
        primitiveId,
        confirmed: false,
        confidence: 0,
        description: `${primitiveId} not applicable to ${target}`,
      }
    }

    const result = await runPrimitive(primitive, techniqueCtx, httpExecutor, gate)

    return {
      primitiveId,
      confirmed: result.confirmed,
      confidence: result.confidence,
      severity: result.severity,
      title: result.finding?.category ?? primitive.name,
      description:
        result.finding?.description ?? result.note ?? `${primitive.name} completed`,
      cwe: result.finding?.cwe,
      payload: result.finding?.request?.body,
      evidence: (result.evidence ?? []).map((e) => ({
        type:
          e.kind === 'request'
            ? 'raw_request'
            : e.kind === 'response'
              ? 'raw_response'
              : 'text',
        data: e.data,
        label: e.label,
        timestamp: Date.now(),
      })),
    }
  }
}
