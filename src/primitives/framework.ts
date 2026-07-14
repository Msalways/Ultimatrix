/**
 * Technique-Primitive Framework (Phase 2 — T2.1)
 *
 * A technique primitive is a self-contained, re-usable security test:
 *   1. generate(ctx)   → concrete attack steps (payloads/requests)
 *   2. executor(step)  → runs a step against the live target (caller supplied, e.g. httpRequest)
 *   3. oracle(results, gate) → evaluates the REAL tool output (recorded in the EvidenceGate)
 *                              and returns confirmed/unconfirmed + evidence.
 *
 * The EvidenceGate is the proof layer: a primitive is only `confirmed: true`
 * when its claim is backed by recorded tool output (no hallucination).
 */

import type { Severity } from '../types/shared'
import type { Finding } from '../generation/test-generator'
import { EvidenceGate } from '../intelligence/evidence-gate'
import type { FindingClaim } from '../intelligence/evidence-ledger'
import { traceRender } from '../capture/render-tracer'

function looksRenderable(body: string): boolean {
  if (!body) return false
  const head = body.slice(0, 512).toLowerCase()
  return (
    head.includes('<html') ||
    head.includes('<body') ||
    head.includes('<!doctype') ||
    /<[a-z][\s\S]*>/.test(body.slice(0, 200))
  )
}

// ─── Context ───────────────────────────────────────────────────────────

/** Target context the primitive reasons about (endpoint/param/role/state). */
export interface TechniqueContext {
  target?: string
  endpoint?: {
    url: string
    method: string
    params?: Array<{ name: string; type?: string; in?: string; required?: boolean }>
    authRequired?: boolean
    authType?: string
  }
  /** The specific parameter under test (e.g. a query/body field name). */
  param?: string
  /** The role/session currently acting. */
  role?: string
  /** Candidate alternate roles (for authz matrix). */
  roles?: string[]
  /** Captured session headers for the actor. */
  sessionHeaders?: Record<string, string>
  /** Captured session headers for an alternate actor (for authz/idor). */
  altSessionHeaders?: Record<string, string>
  /** Object identifier owned by the actor. */
  objectId?: string
  /** Object identifier owned by a different actor. */
  altObjectId?: string
  /** Arbitrary workflow/state captured for the target. */
  state?: Record<string, unknown>
  /** Ordered workflow steps for workflow-bypass reasoning. */
  workflowSteps?: string[]
  /** Optional caller-supplied candidate payloads. */
  payloads?: string[]
  /** Optional extra inputs. */
  [key: string]: unknown
}

// ─── Attack step + execution result ─────────────────────────────────────

/** A concrete, executable attack step produced by a primitive. */
export interface AttackStep {
  id: string
  description: string
  request: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
  }
  /** Human-readable signal expected when the primitive succeeds. */
  expectedSignal?: string
  metadata?: Record<string, unknown>
}

/** Result of running one AttackStep against the live target. */
export interface StepExecutionResult {
  step: AttackStep
  ok: boolean
  status?: number
  headers?: Record<string, string>
  body?: string
  error?: string
  durationMs?: number
  /** Free-form extra observations (e.g. OAST callbacks, timing samples). */
  extra?: Record<string, unknown>
}

/** Callback the caller supplies to actually execute an attack step. */
export type StepExecutor = (step: AttackStep) => Promise<StepExecutionResult>

// ─── Evidence reference ─────────────────────────────────────────────────

/** A reference to REAL tool output, mirroring the EvidenceGate evidence concept. */
export interface EvidenceRef {
  kind: 'request' | 'response' | 'state' | 'oast' | 'tool' | 'render'
  label: string
  /** The actual snippet that was (or will be) recorded into the EvidenceGate. */
  data: string
  /** Optional correlation id (e.g. OAST callback id, step id). */
  ref?: string
}

// ─── Primitive result ──────────────────────────────────────────────────

export interface PrimitiveResult {
  confirmed: boolean
  confidence: number
  evidence: EvidenceRef[]
  severity?: Severity
  finding?: Partial<Finding>
  note?: string
  /** WS-E: render traces captured from HTML responses during this run. */
  renderTraces?: import('../capture/render-tracer').RenderTrace[]
}

// ─── Technique primitive interface ─────────────────────────────────────

export interface TechniquePrimitive {
  id: string
  name: string
  description: string
  /** Optional link to a TechniqueRegistry attack-path keyword (for traceability). */
  technique?: string
  /** Decide whether this primitive is relevant to the given context. */
  appliesTo(ctx: TechniqueContext): boolean
  /** Produce concrete attack steps to execute. */
  generate(ctx: TechniqueContext): Promise<AttackStep[]>
  /** Evaluate the REAL tool output (already recorded in the gate) and return the result. */
  oracle(result: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult>
}

// ─── Registry ──────────────────────────────────────────────────────────

const _primitives = new Map<string, TechniquePrimitive>()

export function registerPrimitive(p: TechniquePrimitive): void {
  _primitives.set(p.id, p)
}

export function getPrimitive(id: string): TechniquePrimitive | undefined {
  return _primitives.get(id)
}

export function listPrimitives(): TechniquePrimitive[] {
  return [..._primitives.values()]
}

export function hasPrimitive(id: string): boolean {
  return _primitives.has(id)
}

// ─── Run helper ─────────────────────────────────────────────────────────

/**
 * Run a primitive end-to-end:
 *   generate → execute each step via `executor` → record outputs into the
 *   EvidenceGate → call oracle → return PrimitiveResult.
 *
 * The oracle MUST consult the EvidenceGate; `confirmed` is only true when the
 * claim is backed by recorded tool output (enforced by the gate + the oracle).
 */
export async function runPrimitive(
  primitive: TechniquePrimitive,
  ctx: TechniqueContext,
  executor: StepExecutor,
  evidenceGate: EvidenceGate,
): Promise<PrimitiveResult> {
  const steps = await primitive.generate(ctx)
  const concurrent = steps.some(s => s.metadata?.concurrent === true)

    const runOne = async (step: AttackStep): Promise<StepExecutionResult> => {
    const res = await executor(step)
    // Record REAL tool output into the proof layer (request + response).
    evidenceGate.recordToolOutput(
      `[${step.request.method} ${step.request.url}] request` +
        (step.request.body ? ` body=${step.request.body}` : ''),
    )
    // Populate the STRUCTURED ledger (the layer verifyClaim actually checks).
    // Without this, confirmations can never be verified against recorded facts.
    evidenceGate.recordObserved({
      type: 'raw_request',
      data: step.request.body ?? '',
      label: `${step.request.method} ${step.request.url}`,
      observed: { method: step.request.method, url: step.request.url, requestHeaders: step.request.headers },
    })
    if (res.status !== undefined) {
      evidenceGate.recordToolOutput(
        `[${step.request.method} ${step.request.url}] response status=${res.status}` +
          (res.body ? ` body=${res.body}` : ''),
      )
      evidenceGate.recordObserved({
        type: 'raw_response',
        data: res.body ?? '',
        label: `${step.request.method} ${step.request.url} → ${res.status}`,
        observed: {
          method: step.request.method,
          url: step.request.url,
          status: res.status,
          responseHeaders: res.headers,
        },
      })
    }
    if (res.error) {
      evidenceGate.recordToolOutput(
        `[${step.request.method} ${step.request.url}] error=${res.error}`,
      )
    }
    // WS-E: trace renderability of HTML responses so a payload's landing spot is
    // grounded evidence (fed to the LLM + persisted as RENDERED_ELEMENT nodes).
    if (res.body && looksRenderable(res.body)) {
      const trace = traceRender(res.body, {
        payloads: step.metadata?.payload ? [String(step.metadata.payload)] : [],
      })
      if (trace.html) {
        res.extra = { ...(res.extra ?? {}), renderTrace: trace }
      }
    }
    return res
  }

  const results = concurrent
    ? await Promise.all(steps.map(runOne))
    : await steps.reduce<Promise<StepExecutionResult[]>>(async (accP, step) => {
        const acc = await accP
        acc.push(await runOne(step))
        return acc
      }, Promise.resolve([]))

  const renderTraces = results
    .map((r) => (r.extra?.renderTrace as import('../capture/render-tracer').RenderTrace | undefined))
    .filter((t): t is import('../capture/render-tracer').RenderTrace => !!t)

  const result = await primitive.oracle(results, evidenceGate)
  return { ...result, renderTraces: renderTraces.length ? renderTraces : undefined }
}

/**
 * Build a structured FindingClaim from a real step result so an oracle can verify
 * against the structured ledger (populated by runPrimitive's recordObserved).
 * Pass the same url/status recorded for that step so the claim co-occurs with a
 * recorded evidence item.
 */
export function claimFor(
  type: string,
  url?: string,
  status?: number,
  method?: string,
): FindingClaim {
  const claim: FindingClaim = { type, endpoint: url ?? '' }
  if (method) claim.method = method
  if (status !== undefined) claim.observed = { status }
  return claim
}
