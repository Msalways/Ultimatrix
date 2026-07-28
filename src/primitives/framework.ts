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
import { PayloadStore } from '../payloads/store'
import { join } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { PROJECT_ROOT } from '../lib/project-root'

const __filename = fileURLToPath(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))

function resolvePayloadsDir(): string {
  const candidates = [
    join(PROJECT_ROOT, 'payloads'),
    join(__dirname, '..', '..', 'payloads'),
    join(process.cwd(), 'payloads'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return join(PROJECT_ROOT, 'payloads')
}

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
    useCase?: string
    tags?: string[]
  }
  param?: string
  role?: string
  roles?: string[]
  sessionHeaders?: Record<string, string>
  altSessionHeaders?: Record<string, string>
  objectId?: string
  altObjectId?: string
  state?: Record<string, unknown>
  workflowSteps?: string[]
  payloads?: string[]
  relationSeed?: import('./constraint-mutators').RelationSeed
  priorResponse?: { status?: number; headers?: Record<string, string>; body?: string }
  variant?: string
  dbms?: string
  oastHost?: string
  requestTemplate?: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
  mutationStrategy?: {
    type: 'shape' | 'enumeration' | 'boundary' | 'type-confusion'
    options?: Record<string, unknown>
  }
  payloadSet?: {
    category: string
    variant?: string
    limit?: number
  }
  multiParam?: boolean
  concurrency?: number
  maxAttempts?: number
  mergedPayloads?: string[]
  [key: string]: unknown
}

/**
 * Load and merge payloads for a given context.
 * Combines static payloads (from PayloadStore) with LLM-crafted payloads.
 * 
 * @param ctx - TechniqueContext with optional payloadSet or payloads
 * @param dedup - Whether to deduplicate merged payloads (default: true)
 * @returns Object with merged payloads and breakdown by source
 */
export function loadPayloads(
  ctx: TechniqueContext,
  dedup: boolean = true
): {
  all: string[]
  bySource: { static: string[]; llm: string[]; merged: string[] }
  uniqueIds: string[]
} {
  // Get LLM-crafted payloads from context
  const llmPayloads = ctx.payloads || []
  const category = ctx.payloadSet?.category
  const variant = ctx.payloadSet?.variant

  // Determine which category to load payloads from
  let staticPayloads: string[]
  if (category) {
    // Load from specified category
    const payloadStore = PayloadStore.getInstance()
    staticPayloads = payloadStore.getPayloads(category, variant)
  } else {
    // No category specified - try common categories
    const payloadStore = PayloadStore.getInstance()
    staticPayloads = []
    // Try loading from a few common injection categories
    const commonCategories = ['injection', 'sql-injection', 'sqli', 'xss', 'cmd-injection', 'nosql-injection']
    for (const cat of commonCategories) {
      if (payloadStore.hasCategory(cat)) {
        staticPayloads = payloadStore.getPayloads(cat, variant)
        break
      }
    }
  }

  // Merge payloads
  return PayloadStore.getInstance().mergePayloads(staticPayloads, llmPayloads, dedup)
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
  /**
   * W1 — exploitation-first signal. When the oracle can prove the finding is
   * weaponizable (real request + observed response + concrete impact), it
   * returns this so the runner persists a first-class EXPLOIT_PROOF node.
   * Typed fields only — `relation` is LLM/registry-discovered, never a fixed
   * string list. Absent for detection-only results.
   */
  exploitProof?: {
    scenario: string
    relation?: string
    request: string
    response: string
    impact: string
  }
  /**
   * W2 — reusable session artifact. When a primitive confirms an auth/seated
   * finding and recovers a live session (cookies/headers), it returns this so
   * the runner persists a first-class AUTH_FLOW node marked reusable. The
   * exploitation loop then reuses it to pivot into other IN-SCOPE endpoints
   * (held-session reach), never via a hardcoded role list. Absent when no
   * session is recovered.
   */
  sessionArtifact?: {
    flowType: 'login' | 'jwt-forgery' | 'default-creds' | 'oauth' | 'session-reuse'
    social?: boolean
    reusable: boolean
    headers: Record<string, string>
    credentialHash?: string
  }
  /**
   * W2 — captured concrete impact data (exfiltrated file contents, victim's
   * object, divergent response). Folds into the proof's impact + evidence so a
   * confirmed finding is demonstrated end-to-end, not just reported. The
   * `kind` is registry-typed, never a frozen vocabulary enum in a prompt.
   */
  dataArtifact?: {
    kind: 'exfil' | 'victim-data' | 'divergent-response' | 'privilege-escalation'
    label: string
    data: string
  }
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
  /** Context signals this primitive adapts to (e.g. 'dbms', 'waf', 'framework'). Declared per-primitive. */
  adaptsTo?: string[]
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
  // Merge LLM-crafted payloads (ctx.payloads) with static defaults.
  // The primitive reads from ctx.mergedPayloads if present; otherwise it
  // falls back to its own payload loading logic (backward compatible).
  if (ctx.payloads && ctx.payloads.length > 0) {
    const existing = ctx.mergedPayloads ?? []
    const seen = new Set(existing.map(p => p.trim().toLowerCase()))
    const llmPayloads = ctx.payloads.filter(p => {
      const key = p.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    ctx.mergedPayloads = [...existing, ...llmPayloads]
  }

  const steps = await primitive.generate(ctx)

  // Tag each step's payload source for provenance tracking.
  // Steps whose payload matches a ctx.payloads entry are tagged 'llm';
  // all others are tagged 'static' (loaded from PayloadStore).
  if (ctx.payloads && ctx.payloads.length > 0) {
    const llmSet = new Set(ctx.payloads.map(p => p.trim().toLowerCase()))
    for (const step of steps) {
      const payload = String(step.metadata?.payload ?? '').trim().toLowerCase()
      if (payload && llmSet.has(payload)) {
        step.metadata = { ...step.metadata, payloadSource: 'llm' }
      } else if (!step.metadata?.payloadSource) {
        step.metadata = { ...step.metadata, payloadSource: 'static' }
      }
    }
  } else {
    for (const step of steps) {
      if (!step.metadata?.payloadSource) {
        step.metadata = { ...step.metadata, payloadSource: 'static' }
      }
    }
  }

  const concurrent = steps.some(s => s.metadata?.concurrent === true)

    const runOne = async (step: AttackStep): Promise<StepExecutionResult> => {
    const res = await executor(step)
    const payloadSource = String(step.metadata?.payloadSource ?? 'static')
    evidenceGate.recordToolOutput(
      `[${step.request.method} ${step.request.url}] request` +
        (step.request.body ? ` body=${step.request.body}` : ''),
    )
    evidenceGate.recordObserved({
      type: 'raw_request',
      data: step.request.body ?? '',
      label: `${step.request.method} ${step.request.url}`,
      observed: { method: step.request.method, url: step.request.url, requestHeaders: step.request.headers, requestBody: step.request.body ?? '', payloadSource },
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
          responseBody: res.body ?? '',
          responseTimeMs: res.durationMs,
          payloadSource,
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
        // W0.3 — expose the prior step's response so chained steps adapt.
        if (acc.length > 0) {
          const prev = acc[acc.length - 1]
          ctx.priorResponse = {
            status: prev.status,
            headers: prev.headers,
            body: prev.body,
          }
        }
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
export interface BodySignature {
  type: 'contains' | 'regex' | 'timing' | 'not-contains' | 'status-differs'
  pattern: string
  threshold?: number
}

export function claimFor(
  type: string,
  url?: string,
  status?: number,
  method?: string,
  bodySignature?: BodySignature,
): FindingClaim {
  const claim: FindingClaim = { type, endpoint: url ?? '' }
  if (method) claim.method = method
  const observed: Record<string, unknown> = {}
  if (status !== undefined) observed.status = status
  if (bodySignature) observed.bodySignature = bodySignature
  if (Object.keys(observed).length > 0) claim.observed = observed as FindingClaim['observed']
  return claim
}

/**
 * Behavioral, status-authoritative access assessment for vuln oracles.
 *
 * Design principle (anti-rigidity): keyword substring lists are a *secondary*
 * signal only. The authoritative verdict comes from observable HTTP behavior
 * (status class, session-cookie issuance, redirect-to-login). A custom
 * application that uses non-English or non-standard success/denial copy is
 * still correctly assessed because we never rely on the keyword alone.
 *
 * - granted: 3xx that is NOT a redirect-to-login, or a session cookie, or a
 *   success marker. A bare 2xx only grants when `grantsOn2xx` (default true) —
 *   state-changing endpoints treat any 2xx as "action went through", while an
 *   auth/login endpoint should require a positive signal (cookie/keyword) so a
 *   bare empty 200 does not over-fire.
 * - denied:  401/403, or 400-with-denial-copy, or any deny marker.
 * On conflict (text says both), status wins. Confidence reflects how much of
 * the verdict is behavioral vs keyword-only.
 */
export interface AccessAssessment {
  denied: boolean
  granted: boolean
  signals: string[]
  confidence: number
}

export function assessAccess(input: {
  status?: number
  body?: string
  setCookie?: string
  denyMarkers?: string[]
  successMarkers?: string[]
  grantsOn2xx?: boolean
}): AccessAssessment {
  const status = input.status ?? 500
  const lower = (input.body ?? '').toLowerCase()
  const cookie = input.setCookie ?? ''
  const grantsOn2xx = input.grantsOn2xx !== false

  const redirectToLogin =
    status >= 300 && status < 400 && /(log\s?in|sign\s?in|authentication|session expired)/i.test(lower)

  const statusDenied =
    status === 401 || status === 403 || (status === 400 && /unauthorized|forbidden|denied|invalid/i.test(lower))
  const statusGranted = (grantsOn2xx && status >= 200 && status < 300) || (status >= 300 && status < 400 && !redirectToLogin)

  const denyByText = (input.denyMarkers ?? []).some((m) => lower.includes(m))
  const successByText = (input.successMarkers ?? []).some((m) => lower.includes(m))
  const cookieGranted = /session|token|auth|jwt|sid/i.test(cookie)

  const denied = statusDenied || denyByText || redirectToLogin
  const granted = statusGranted || successByText || cookieGranted

  const signals: string[] = []
  if (statusDenied) signals.push(`status-denied-${status}`)
  if (statusGranted) signals.push(`status-granted-${status}`)
  if (denyByText) signals.push('deny-marker')
  if (successByText) signals.push('success-marker')
  if (cookieGranted) signals.push('session-cookie')
  if (redirectToLogin) signals.push('redirect-to-login')

  let confidence = 0
  if (statusDenied || statusGranted) confidence = 0.8
  else if (cookieGranted || successByText || denyByText) confidence = 0.45

  // Conflict: trust status over verbatim copy.
  if (denied && granted) {
    const resolved = statusGranted && !statusDenied
    return {
      denied: statusDenied,
      granted: resolved,
      signals: [...signals, 'conflict-status-wins'],
      confidence: statusDenied || statusGranted ? 0.8 : 0.3,
    }
  }

  return { denied, granted, signals, confidence }
}
